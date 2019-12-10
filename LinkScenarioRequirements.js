const { Webhooks } = require('@qasymphony/pulse-sdk');

// @pure
const standardHeaders = (qTestToken, scenarioPojectId) => ({
    'Content-Type': 'application/json',
    'Authorization': `bearer ${qTestToken}`,
    'x-scenario-project-id': scenarioPojectId
});

// @pure
const options = (url, headers) => new Request(`${url}/api/features`, {
    method: 'GET',
    headers: headers
});

// @pure
const genericRequest = (url, headers, body) => new Request(url, {
    url: url,
    method: 'POST',
    headers: headers,
    body: JSON.stringify(body)
});

// @pure
const testCasesRequest = (url, headers, tcName) => {
    const body = {
        "object_type": "test-cases",
        "fields": [
            "*"
        ],
        "query": `Name = '${tcName}'`
    }
    return genericRequest(url, headers, body);
};

// @pure
const requirementsRequest = (url, headers, key) => {
    const body = {
        "object_type": "requirements",
        "fields": [
            "*"
        ],
        "query": `Name ~ '${key}'`
    }
    return genericRequest(url, headers, body);
};

// @pure
const linksRequest = (url, headers, reqid, tcid) => {
    const body = [
        tcid
    ]
    return genericRequest(url, headers, body);
};

// @pure
const findMatchingFeature = (testCase, scenarioFeatures) =>
    scenarioFeatures.find(
        scenarioFeature => scenarioFeature.name === testCase.featureName
    );

// @pure
const testCasesExistingOnScenario = (testCase, scenarioFeatures) =>
    findMatchingFeature(testCase, scenarioFeatures) != null;

// @pure
const searchResponseContainsNoItems = object => object.items.length === 0;

// @pure
const isNotBackground = ({ keyword }) => keyword.toLowerCase() !== 'background';

// @pure
const sleep = milliSeconds =>
    new Promise(
        resolve => setTimeout(resolve, milliSeconds)
    );

// @impure: mutable object
const State = {
    constants: null,
    triggers: null,
    projectId: null,
}

// @impure: reliant on network and the mutable object State
const emitEvent = (name, payload) => {
    const t = State.triggers.find(t => t.name === name);
    return t && new Webhooks().invoke(t, payload);
}

// @impure: reliant on mutable object State
const getStandardHeaders = () => standardHeaders(State.constants.QTEST_TOKEN, State.constants.SCENARIO_PROJECT_ID);

// @impure: reliant on mutable object State
const getOptions = () => {
    const headers = getStandardHeaders();
    return options(State.constants.Scenario_URL, headers);
}

// @impure: reliant on mutable object State
const getManagerSearchUrl = () => `${State.constants.ManagerURL}/api/v3/projects/${State.projectId}/search`;

// @impure: reliant on mutable object State
const testCasesFromManager = tcName => {
    const url = getManagerSearchUrl();
    const headers = getStandardHeaders();
    return testCasesRequest(url, headers, tcName);
}

// @impure: reliant on mutable object State
const requirementsFromManager = key => {
    const url = getManagerSearchUrl();
    const headers = getStandardHeaders();
    return requirementsRequest(url, headers, key);
}

// @impure: reliant on mutable object State
const testCaseLinkOnRequirement = (reqId, testCaseId) => {
    const url = `${State.constants.ManagerURL}/api/v3/projects/${State.projectId}/requirements/${reqId}/link?type=test-cases`
    const headers = getStandardHeaders();
    return linksRequest(url, headers, reqId, testCaseId)
}

// @impure: reliant on network
const getRequirementId = async function({ issueKey }) {
    const response = await fetch(requirementsFromManager(issueKey));
    const requirements = await response.json();

    if (searchResponseContainsNoItems(requirements)) {
        return Promise.reject("[Info] No matching requirement found");
    }
    return Promise.resolve(requirements.items[0].id);
}

// @impure: reliant on network
const getMatchingTestCases = async function(name) {
    const response = await fetch(testCasesFromManager(name));
    return response.json();
}

// @impure: reliant on network
const getTestCaseId = async function({ name }) {
    let testCases = await getMatchingTestCases(name);

    // Implement retry logic to handle the delay when a new test case is created
    for (let attempt = 1; attempt <= 10 && searchResponseContainsNoItems(testCases); attempt++) {
        console.log(`[Info] Retrying to get matching test cases, attempt (${attempt})...`);
        await sleep(5000);
        testCases = getMatchingTestCases(name);
    }

    if (searchResponseContainsNoItems(testCases)) {
        return Promise.reject(`[Info] No matching test case found: ${name}`);
    }
    return Promise.resolve(testCases.items[0].id);
}

// @impure: reliant on network and uses I/O
const useReqAndTcIdToCreateLink = async function(reqId, testCaseId, { name }, { issueKey }) {
    try {
        const response = await fetch(testCaseLinkOnRequirement(reqId, testCaseId));
        await emitEvent('SlackEvent', { Linking: `link added for TC: ${name} to requirement ${issueKey}` });
        console.log(`[Info] A link is added TC: ${name} -> Req: ${issueKey}`);
    } catch (error) {
        await emitEvent('SlackEvent', { Error: `Problem creating test link to requirement: ${error}` });
        return Promise.reject(`[Error] Failed to create a link. ${error}`);
    }
}

// @impure: reliant on network and uses I/O
const createLink = async function(testCase, scenarioFeatures) {
    try {
        const matchingFeature = findMatchingFeature(testCase, scenarioFeatures);
        const reqId = await getRequirementId(matchingFeature);
        const testCaseId = await getTestCaseId(testCase);
        const response = await useReqAndTcIdToCreateLink(reqId, testCaseId, testCase, matchingFeature);
    } catch (error) {
        console.log(error);
    }
}

// @impure: reliant on network
const linkRequirements = async function(testCases, scenarioFeatures) {
    const matchingTestCases = testCases.filter(testcase =>
        testCasesExistingOnScenario(testcase, scenarioFeatures));

    return Promise.all(
        matchingTestCases.map(testCase => createLink(testCase, scenarioFeatures))
    )
}

// Entry point to the script
// @impure: reliant on network and uses I/O
exports.handler = async function({ event: body, constants, triggers }, context, callback) {
    console.log("[Info] Starting Link Requirements Action");

    const { logs, projectId } = body;
    const testCases = logs.filter(isNotBackground);

    State.constants = constants;
    State.triggers = triggers;
    State.projectId = projectId;

    try {
        const options = getOptions(constants.Scenario_URL);
        const response = await fetch(options);
        const scenarioFeatures = await response.json();
        console.log("Got Features List:", scenarioFeatures);
        await linkRequirements(testCases, scenarioFeatures);

    } catch (error) {
        console.log("[Error]", error);
        throw error;
    }
    console.log("[Info] Finished linking requirements");
}