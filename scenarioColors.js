const ScenarioSdk = require('@qasymphony/scenario-sdk');

// @pure
const flattenArray = (acc, arrayValue) => acc.concat(arrayValue);

// @pure
const testStepLogs = ({ test_step_logs }) => test_step_logs;

// @pure
const steps = logs => logs
    .map(testStepLogs)
    .reduce(flattenArray);

// Ensures the status matches a status supported by Scenario: One of PASSED (green), FAILED (red), or SKIPPED (yellow)
// @pure
const processStatus = ({ status }) => ("undefined" === status) ? "FAILED" : status.toUpperCase();

// @impure: mutable
const State = {
    sdk: null
}

// @impure: Data returned is dependent on where the ScenarioSDK is pointing
const getStepSdk = (qtestToken, scenarioProjectId) => new ScenarioSdk.Steps({ qtestToken, scenarioProjectId });

// @impure: has side effects (updates ScenarioSdk)
const setConfigAndRetrieveSDK = (scenarioUrl, qtestToken, scenarioProjectId) => {
    ScenarioSdk.config({ scenarioUrl: scenarioUrl });
    return getStepSdk(qtestToken, scenarioProjectId);
}

// @impure: uses I/O 
const loggingOutError = err => console.log('Error updating colors: ' + err);

// @impure: reliant on state object
const addingStatusToStep = (sdkStep, status) => State.sdk.updateStep(
    sdkStep.id,
    Object.assign(sdkStep, { "status": status })
);

// @impure: reliant on network
const asyncronouslyUpdateTheStatusOfEachStep = (sdkSteps, status) => Promise.all(sdkSteps.map((sdkStep) => addingStatusToStep(sdkStep, status)));

// Grabs all of the steps matching the step description using the Scenario API and then updates their status based on the test results
// Note - Whilst the test results can feature a step multiple times, the API only appears to return a single instance, so the status will get set multiple times, and if there is 
// different a statuses the last one set will win  E.g. in one instance the step passed and in another it failed you are at the mercy of the order in which the promises resolve as to
// which gets set in Scenario.
// There are several ways where we could actively prioritise setting one status over the other, but I'm not sure which would be more desirable. E.g. If we have a step that ran twice and in one instance it passes and in one it fails. 
// If we took the passed result we would be masking a failure, but if we took a failed result the output of the scenario where the step passed would be confusing. (It would appear as if it continued to run other steps after a step failed.)
// This is a limitation of the Scenario SDK and should be raised with Tricentis.
// @impure: reliant on state object
const updateStepResults = (name, status) => {
    State.sdk.getSteps(`"${name}"`)
        .then(sdkSteps => asyncronouslyUpdateTheStatusOfEachStep(sdkSteps, status))
        .catch(loggingOutError);
}

// @impure: calls updateStepResults which is reliant on network
const updateStep = (step, index) => updateStepResults(step.expected_result, processStatus(step));

// @impure: sets state and performs network actions
exports.handler = function({ event: body, constants, triggers }, context, callback) {
    const payload = body;

    State.sdk = setConfigAndRetrieveSDK(constants.Scenario_URL, constants.QTEST_TOKEN, constants.SCENARIO_PROJECT_ID);

    steps(payload.logs).forEach(updateStep);
}