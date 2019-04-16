const { Webhooks } = require('@qasymphony/pulse-sdk');

// @pure
const State = {
    triggers: null,
};

// @pure
const isNotBackground = ({ keyword }) => keyword.toLowerCase() !== 'background';

// @pure
const getHeaders = (token) => ({
    'Content-Type': 'application/json',
    'Authorization': `bearer ${token}`
});

// @pure
const getBody = (cycleId, testLogs) => JSON.stringify({
    test_cycle: cycleId,
    test_logs: testLogs
});

// @pure
const generateRequest = ({ ManagerURL, QTEST_TOKEN }, cycleId, projectId, testLogs) => {
    const url = `${ManagerURL}/api/v3/projects/${projectId}/auto-test-logs?type=automation`;

    const data = {
        method: "POST",
        headers: getHeaders(QTEST_TOKEN),
        body: getBody(cycleId, testLogs)
    };

    return new Request(url, data);
};

// @impure: reliant on network connectivity
const emitEvent = (name, payload) => {
    const t = State.triggers.find(t => t.name === name);
    return t && new Webhooks().invoke(t, payload);
};

// @impure: reliant on network connectivity
async function postTestLogsToTestManager(request) {
    const response = await fetch(request);
    const resbody = await response.json();

    emitEvent('SlackEvent', { AutomationLogUploaded: resbody });

    if (resbody.type === "AUTOMATION_TEST_LOG") {
        return Promise.resolve("Uploaded results successfully");
    }

    emitEvent('SlackEvent', { Error: "Wrong type" });
    return Promise.reject("Unable to upload test results");
};

// @impure: reliant on network connectivity and uses I/O
async function postLogsAndCallAdditionalPulseActions(request, payload) {
    try {
        const response = await postTestLogsToTestManager(request);
        console.log(response);
        await emitEvent('LinkScenarioRequirements', payload);
        await emitEvent('UpdateDescriptionPreconditionAndPrettify', payload);

    } catch (error) {
        const { url, status, statusText } = error;
        const errorMessage = (url != null) ?
            `url: ${url}, status: ${status}, status text: ${statusText}` :
            error;

        console.log('Caught Error:', errorMessage);
        emitEvent('SlackEvent', { CaughtError: errorMessage });
    }
};

// @impure: sets state, relies on network connectivity and uses I/O
exports.handler = ({ event: body, constants, triggers }, context, callback) => {
    State.triggers = triggers;

    const { logs, "test-cycle": cycleId, projectId } = body;

    const testLogs = logs.filter(isNotBackground);

    const request = generateRequest(constants, cycleId, projectId, testLogs);

    postLogsAndCallAdditionalPulseActions(request, body);
};