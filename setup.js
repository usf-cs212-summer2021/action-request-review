const core = require('@actions/core');
const github = require('@actions/github');
const exec = require('@actions/exec');
const utils = require('./utils.js');

async function run() {
  const status = {}; // status of intermediate steps
  const states = {}; // things to remember between pre/main/post

  const token = core.getInput('token');
  core.setSecret(token);

  const octokit = github.getOctokit(token);

  try {
    // get project details from release
    const release = core.getInput('release');
    const parsed = utils.parseProject(github.context, release);

    Object.assign(states, parsed);

    // check release is valid and verified
    const verified = await utils.verifyRelease(octokit, github.context, states.version);

    states.releaseUrl  = verified.release.html_url;
    states.releaseTag  = verified.release.tag_name;
    states.releaseDate = verified.release.created_at;

    states.runNumber = verified.workflow.run_number;
    states.runId  = verified.workflow.id;
    states.runUrl = verified.workflow.html_url;

    // check functionality issue for project exists
    core.startGroup('Checking issues...');
    core.info('');

    const funIssues = await utils.getIssues(octokit, github.context, states.project, 'functionality');

    const funPassed = funIssues.find(x => x.state == 'closed' && x.locked == true && x.active_lock_reason == 'resolved');

    if (!funPassed) {
      throw new Error(`Unable to detect approved functionality issue for project ${project}. You must pass functionality before requesting code review.`);
    }

    core.info(`Passing functionality issue: ${funPassed.html_url}`);
    states.issueNumber = funPassed.number;
    states.issueUrl = funPassed.html_url;

    core.info('');
    core.endGroup();

    // check pull requests for project

    // save states
    utils.saveStates(states);
  }
  catch (error) {
    utils.showError(`${error.message}\n`); // show error in group
    core.endGroup();  // end group

    // displays outside of group; always visible
    core.setFailed(`Setup failed. ${error.message}`);
  }
  finally {
    core.startGroup('Logging setup status...');
    core.info(`status: ${JSON.stringify(status)}`);
    core.info(`states: ${JSON.stringify(states)}`);
    core.endGroup();

    utils.checkWarnings('"Pre Request Review"');
  }
}

run();
