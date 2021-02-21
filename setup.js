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

  const release = core.getInput('release');
  core.info(`Release: ${release}`);

  try {
    utils.parseProject(github.context, release);

    // -----------------------------------------------

    // save states
    utils.saveStates(states);
  }
  catch (error) {
    utils.showError(`${error}\n`); // show error in group
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
