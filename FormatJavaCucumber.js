const { Webhooks } = require('@qasymphony/pulse-sdk');

// Returns an array of step names
// @pure
const getStepNames = testCase => testCase.steps.map(step => step.name);

// Create a deep clone of object when wanting to avoid mutating original data, this method is only safe if the supplied object is 100% parsable in JSON
// @pure
const createDeepCloneOfJsonObject = object => JSON.parse(JSON.stringify(object));

// Creates a clone of the step before iterating through the attachments contained within it, adding a 'step_name' field
// @pure
const attachmentsWithStepNameInjected = (step) => createDeepCloneOfJsonObject(step).embeddings.map(injectStepName, step);

// Flattens a multidimensional array, into a simple array by storing each value in the accumulator
// @pure
const flattenArray = (acc, arrayValue) => acc.concat(arrayValue);

// @pure
const hasEmbeddings = object => object.hasOwnProperty("embeddings");

// @pure
const attachmentInformation = (attachment, index) => {
    return {
        name: `${attachment.step_name} Attachment ${index + 1}`,
        "content_type": attachment.mime_type,
        data: attachment.data
    }
};

// @pure
const getStepAttachments = testCase => testCase.steps.filter(hasEmbeddings)
    .map(attachmentsWithStepNameInjected)
    .reduce(flattenArray, [])
    .map(attachmentInformation);

// @pure
const getHookAttachments = testCase => (testCase.hasOwnProperty("after")) ? testCase.after.filter(hasEmbeddings)
    .map(attachmentsWithStepNameInjected)
    .reduce(flattenArray, [])
    .map(attachmentInformation) : [];

// Grabs all attachments from the hooks and steps and combines them into a single flat array of attachment information
// @pure
const getAllAttachments = testCase => getStepAttachments(testCase).concat(getHookAttachments(testCase));

// Creates a clone of the feature before iterating through the test cases contained within it, adding the 'feature_name' and 'feature_uri' fields.
// @pure
const testCasesWithFeatureNameAndUriInjected = feature => createDeepCloneOfJsonObject(feature).elements.map(injectFeatureNameAndUri, feature);

// @pure
const moduleThatHasFeatureFileExtension = (module) => module.includes(".FEATURE");

// @pure
const getLowerCaseFeatureNameNoExtension = name => name.toLowerCase()
    .replace(".feature", "");

// @pure
const getUpperCaseSubModules = url => url.replace(/.+features\//i, "")
    .toUpperCase()
    .split("/");

// @pure
const addParentFeaturesModuleAndReplaceLastModule = (moduleArray, replacementModule) => {
    const modules = ["FEATURES"].concat(moduleArray);
    modules.pop();
    modules.push(replacementModule);
    return modules;
}

// gets all of the folders after the 'features' directory
// @pure
const getModules = URI => {
    const subModules = getUpperCaseSubModules(URI);
    const featureName = getLowerCaseFeatureNameNoExtension(
        subModules.find(moduleThatHasFeatureFileExtension)
    );
    return addParentFeaturesModuleAndReplaceLastModule(subModules, featureName);
}

// Injects the step name into the attachment object, relying on the context of 'this' to be set to a step object 
// e.g. an arrow function cannot be used
// @impure: relies on the context of 'this'
const injectStepName = function(attachment) {
    attachment.step_name = this.name || "Hook";
    return attachment;
}

// Enum object to handle possible statuses within cucumber json output and in qTest Manager
// @impure: mutable
const Status = {
    PASSED: "passed",
    FAILED: "failed",
    SKIPPED: "skipped",
    UNDEFINED: "undefined",
    PENDING: "pending",
    BLOCKED: "blocked",
}

// Calculates the overall testcase status based on the result of the passed in step, storing the result in the accumulator
// @impure: reliant on mutable object
const testCaseStatus = (acc, step) => (Status.PASSED === acc) ? step.result.status : acc;

// Gets the testcase status based on the result of each step
// @impure: reliant on mutable object
const getTCStatus = testCase => testCase.steps.reduce(testCaseStatus, Status.PASSED);

// Returns an  actual result based on step.result.status
// A step is skipped when a previous step, background step or before hook fails
// A step is undefined when it exists in a feature but no definition is found
// A step is pending when it exists in a feature file, has a defition, but explicitly throws a PendingException
// @impure: reliant on mutable object
const getActualResult = step => {
    return {
        [Status.PASSED]: step.name,
        [Status.FAILED]: step.result.error_message,
        [Status.SKIPPED]: "This step has been skipped due to a previous failure",
        [Status.UNDEFINED]: "This step does not match any step definitions",
        [Status.PENDING]: "This step is marked as pending"
    } [step.result.status];
}

// Generates a step log object for injection into a test log
// @impure: reliant on mutable object
const testStepLogs = testCase => testCase.steps.map((step, index) => {
    return {
        order: index,
        description: `${step.keyword}`,
        expected_result: step.name,
        actual_result: getActualResult(step),
        status: step.result.status
    };
});

// Injects the feature name and URI into the test case object, relying on the context of 'this' to be set to a feature object 
// e.g. an arrow function cannot be used
// @impure: reliant on the context of 'this'
const injectFeatureNameAndUri = function(testCase) {
    testCase.feature_uri = this.uri;
    testCase.feature_name = this.name;
    return testCase;
}

// Create a new object to represent a test log and populate it's fields
// @impure: reliant on mutable object
const testLogs = testCase => ({
    exe_start_date: new Date(), // TODO These could be passed in
    exe_end_date: new Date(),
    module_names: getModules(testCase.feature_uri),
    name: testCase.hasOwnProperty("name") ? testCase.name : "Unnamed",
    automation_content: testCase.feature_uri + "#" + testCase.name,
    attachments: getAllAttachments(testCase),
    status: getTCStatus(testCase),
    test_step_logs: testStepLogs(testCase),
    keyword: testCase.keyword,
    featureName: testCase.feature_name,
    description: testCase.description,
});

// Loops through all of the features and test cases creating a test log for each
// @impure: reliant on mutable object
const generateTestLogs = features => features.map(testCasesWithFeatureNameAndUriInjected)
    .reduce(flattenArray, [])
    .map(testLogs);

// @impure: mutable
const State = {
    triggers: null
}

// @impure: reliant on state and network
const emitEvent = (name, payload) => {
    let t = State.triggers.find(t => t.name === name);
    return t && new Webhooks().invoke(t, payload);
}

// Entry point to the script, it takes the cucumber json input and reformat it into qTest Manager friendly
// json before handing it off to the down stream rule
// @impure: reliant on state and network connectivity
exports.handler = ({ event: body, constants, triggers }, context, callback) => {

    State.triggers = triggers;

    const payload = body;

    const formattedResults = {
        "projectId": payload.projectId,
        "test-cycle": payload["test-cycle"],
        "logs": generateTestLogs(payload.result)
    };

    // Pulse Version
    // Emit next fxn to upload results/parse
    emitEvent('UpdateQTestWithFormattedResultsEvent', formattedResults);
}