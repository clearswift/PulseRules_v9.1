const PulseSdk = require('@qasymphony/pulse-sdk');
const request = require('request');
const xml2js = require('xml2js');

// @pure
const isBackground = ({ keyword }) => keyword.toLowerCase() === 'background';

// @pure
const getHeaders = (token) => ({
    'Content-Type': 'application/json',
    'Authorization': `bearer ${token}`
});

// @pure
const convertKeywordAndNameToParagraph = (keyword, name) =>
    `<p><span style='color: #808000;;'><strong>${keyword}:</strong></span> ${name}</p>`;

// @pure
const convertStepToSpanWithBreak = ({ description, expected_result }) =>
    `<span style='color: #008080; padding-left: 10px'><strong>${description}</strong></span>${expected_result}<br>`;

// @pure
const convertDescriptionToParagraph = description => `<p style='padding-left: 10px'><em>${description}</em></p>`;

// @pure
const convertStepLogsToPrecondition = ({ keyword, name, description, test_step_logs }) => {
    const header = convertKeywordAndNameToParagraph(keyword, name);
    const summary = (description !== "") ? convertDescriptionToParagraph(description) : "";
    const paragraphs = test_step_logs.map(convertStepToSpanWithBreak);

    return `${header}${summary}${paragraphs.join("")}`;
}

// @pure
const isDuplicateField = (item, index, array, property) => array.map(object => object[property])
    .indexOf(item[property]) !== index;

// @pure
const removingDuplicatesCausedByScenarioOutlines = (item, index, arr) => {
    const isDuplicateName = isDuplicateField(item, index, arr, "name");
    const isDuplicateFeatureName = isDuplicateField(item, index, arr, "featureName");

    return !(isDuplicateName && isDuplicateFeatureName);
};

// @pure
const isNotABackgroundAndHasAMatchingFeatureName = ({ keyword, featureName }, nameToMatch) =>
    (featureName === nameToMatch) && (keyword.toLowerCase() !== 'background');

// @pure
const getSearchUrl = (managerUrl, projectId) => `https://${managerUrl}/api/v3/projects/${projectId}/search`

// @pure
const getSearchBody = name => ({
    object_type: "test-cases",
    fields: ["id", "test_steps"],
    query: `name = '${name}'`
});

// @pure
const getUpdateTestCaseUrl = (managerUrl, projectId, id) => `https://${managerUrl}/api/v3/projects/${projectId}/test-cases/${id}`;

// @pure
const formatDescriptionIfNotEmpty = description => description !== "" ? convertDescriptionToParagraph(description) : "";

// @pure
const getUpdateTestCaseBody = (precondition, description) => ({
    precondition: precondition,
    description: formatDescriptionIfNotEmpty(description)
});

// @pure
const sleep = milliSeconds => new Promise(
    resolve => setTimeout(resolve, milliSeconds)
);

// @impure: mutable
const State = {
    projectId: null,
    managerUrl: null,
    qTestToken: null,
    logs: null
}

// @impure: reliant on network and mutable state
const performApiCall = async function(url, method, body) {
    const { qTestToken } = State;
    const payload = {
        method: method,
        headers: getHeaders(qTestToken),
        body: JSON.stringify(body)
    }
    const response = await fetch(url, payload);

    return response.json();
}

// @impure: reliant on network and mutable state and uses I/O
const getTestCaseId = async function({ name }) {
    const { managerUrl, projectId } = State;
    const url = getSearchUrl(managerUrl, projectId);
    const body = getSearchBody(name);

    let resbody = await performApiCall(url, "POST", body);

    // Implement retry logic to handle the delay when a new test case is created
    for (let attempt = 1; attempt <= 10 && resbody.items.length === 0; attempt++) {
        console.log(`Retrying to get matching test cases, attempt (${attempt})...`);
        await sleep(5000);
        resbody = await performApiCall(url, "POST", body);
    }

    if (resbody.items.length === 0) {
        return Promise.reject(`Failed to return a matching test case for '${name}'`);
    }

    return Promise.resolve(resbody.items[0].id);
}

// @impure: reliant on network and mutable state
const updateAllTestCases = async function(testCase) {
    const { precondition } = this;
    const { description } = testCase;
    const id = await getTestCaseId(testCase);

    return await updateTestCaseFields(id, precondition, description);
}

// @impure: reliant on network and mutable state
async function updateTestCaseFields(id, precondition, description) {
    const { managerUrl, projectId } = State;
    const url = getUpdateTestCaseUrl(managerUrl, projectId, id);
    const body = getUpdateTestCaseBody(precondition, description);

    return await performApiCall(url, "PUT", body);
}

// @impure: reliant on network and mutable state
async function generatePreconditionAndPostToManager(background) {
    const { logs } = State;
    const nameToMatch = background.featureName;
    const precondition = { precondition: convertStepLogsToPrecondition(background) };
    const matchingTestCases = logs.filter(
        log => isNotABackgroundAndHasAMatchingFeatureName(log, nameToMatch)
    );

    return await Promise.all(
        matchingTestCases.map(updateAllTestCases, precondition)
    );
}

// Entry point to the script
// @impure: reliant on network and uses I/O
exports.handler = async function({ event: body, constants, triggers }, context, callback) {
    const { logs, projectId } = body;
    const { ManagerURL, QTEST_TOKEN } = constants;
    const backgrounds = logs.filter(isBackground)
        .filter(removingDuplicatesCausedByScenarioOutlines);

    State.projectId = projectId;
    State.managerUrl = ManagerURL;
    State.qTestToken = QTEST_TOKEN;
    State.logs = logs;

    try {
        await Promise.all(
            backgrounds.map(generatePreconditionAndPostToManager)
        );
        console.log("Successfully updated all test cases");
    } catch (error) {
        console.log(error);
    }

    console.log("End of job");
}