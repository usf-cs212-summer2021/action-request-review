const core = require('@actions/core');
const github = require('@actions/github');
const exec = require('@actions/exec');
const style = require('ansi-styles');

exports.warnings = 0; // track warnings

exports.mainDir = 'project-main';   // otherwise project-username
exports.testDir = 'project-tests';  // must match pom.xml and repository name

function styleText(color, bgColor, label, text) {
  core.info(`${style[bgColor].open}${style.black.open}${style.bold.open}${label}:${style.bold.close}${style.black.close}${style[bgColor].close} ${style[color].open}${text}${style[color].close}`);
}

exports.showTitle = function(text) {
  core.info(`\n${style.cyan.open}${style.bold.open}${text}${style.bold.close}${style.cyan.close}`);
};

exports.showError = function(text) {
  styleText('red', 'bgRed', 'Error', text);
};

exports.showSuccess = function(text) {
  styleText('green', 'bgGreen', 'Success', text);
};

exports.showWarning = function(text) {
  exports.warnings++;
  styleText('yellow', 'bgYellow', 'Warning', text);
};

exports.checkWarnings = function(phase) {
  if (exports.warnings > 1) {
    core.warning(`There were ${exports.warnings} warnings in the ${phase} phase. View the run log for details.`);
  }
  else if (exports.warnings == 1) {
    core.warning(`There was ${exports.warnings} warning in the ${phase} phase. View the run log for details.`);
  }
};

exports.saveStates = function(states) {
  core.startGroup('Saving state...');
  core.info('');

  for (const state in states) {
    core.saveState(state, states[state]);
    core.info(`Saved value ${states[state]} for state ${state}.`);
  }

  core.saveState('keys', JSON.stringify(Object.keys(states)));

  core.info('');
  core.endGroup();
};

exports.restoreStates = function(states) {
  core.startGroup('Restoring state...');
  core.info('');

  const keys = JSON.parse(core.getState('keys'));
  core.info(`Loaded keys: ${keys}`);

  for (const key of keys) {
    states[key] = core.getState(key);
    core.info(`Restored value ${states[key]} for state ${key}.`);
  }

  core.info('');
  core.endGroup();
  return states;
};

exports.parseProject = function(context, ref) {
  core.startGroup('Parsing project details...');
  core.info('');

  const details = {};

  const owner = context.repo.owner;
  const repo = context.repo.repo;

  details.owner    = owner;
  details.mainRepo = `${owner}/${repo}`;
  details.testRepo = `${owner}/${exports.testDir}`;

  const tokens = ref.split('/');
  const version = tokens[tokens.length - 1];

  const regex = /^v([1-4])\.(\d+)\.(\d+)$/;
  const matched = version.match(regex);

  if (matched !== null && matched.length === 4) {
    details.project = +matched[1];
    details.reviews = +matched[2];
    details.patches = +matched[3];
    details.version = version;
  }
  else {
    throw new Error(`Unable to parse project information from: ${ref}`);
  }

  core.info(`Project version: ${details.version}`);
  core.info(`Project number:  ${details.project}`);
  core.info(`Project reviews: ${details.reviews}`);
  core.info(`Project patches: ${details.patches}`);

  core.info('');
  core.endGroup();

  return details;
};

// COMMAND-LINE HELPER FUNCTIONS

/*
 * Checks the exit code after executing a command and throws
 * an error if it is non-zero. Useful since exec.exec triggers
 * failure on non-zero exit codes by default.
 *
 * command: the command to exec
 * settings.param: the parameters to use (array)
 * settings.title: the title to output before executing
 * settings.error: the error message to use for non-zero exit code
 *                 (if not specified, no error is thrown)
 * settings.chdir: working directory to use
 */
exports.checkExec = async function(command, settings) {
  const options = {ignoreReturnCode: true};

  if ('chdir' in settings) {
    options.cwd = settings.chdir;
  }

  const param = 'param' in settings ? settings.param : [];

  if ('title' in settings) {
    core.info(`\n${settings.title}...`);
  }

  const result = await exec.exec(command, param, options);

  if ('error' in settings && result !== 0) {
    throw new Error(`${settings.error} (${result}).`);
  }

  return result;
};

// OCTOKIT HELPER FUNCTIONS

exports.verifyRelease = async function(octokit, context, release) {
  core.startGroup('Checking release details...');
  core.info('');

  const owner = context.repo.owner;
  const repo = context.repo.repo;

  const details = {};

  try {
    // https://docs.github.com/en/rest/reference/repos#get-a-release-by-tag-name
    core.info(`Getting release ${release} from ${repo}...`);
    const result = await octokit.repos.getReleaseByTag({
      owner: owner, repo: repo, tag: release
    });

    if (result.status != 200) {
      core.info(JSON.stringify(result));
      throw new Error(`${result.status} exit code`);
    }

    core.info(`Found Release: ${result.data.html_url}`);
    details.release = result.data;
  }
  catch (error) {
    // produce better error output
    throw new Error(`Unable to fetch release ${release} (${error.message.toLowerCase()}).`);
  }

  core.info('');

  try {
    // https://docs.github.com/en/rest/reference/actions#list-workflow-runs-for-a-repository
    core.info('Listing workflow runs...');
    const result = await octokit.actions.listWorkflowRuns({
      owner: owner,
      repo: repo,
      workflow_id: 'run-tests.yml',
      event: 'release'
    });

    if (result.status != 200) {
      core.info(JSON.stringify(result));
      throw new Error(`${result.status} exit code`);
    }

    const branches = result.data.workflow_runs.map(r => r.head_branch);
    core.info(`Found Runs: ${branches.join(', ')}`);

    const found = result.data.workflow_runs.find(r => r.head_branch === release);

    if (found === undefined) {
      throw new Error(`workflow run not found`);
    }

    if (found.status != "completed" || found.conclusion != "success") {
      core.info(JSON.stringify(found));
      throw new Error(`run #${found.run_number} id ${found.id} not successful`);
    }

    core.info(`Found Run: ${found.html_url}`);
    details.workflow = found;
  }
  catch (error) {
    throw new Error(`Unable to verify release ${release} (${error.message.toLowerCase()}).`);
  }

  core.info('');
  core.endGroup();

  return details;
};

// TODO: Filter out pull_request key?
exports.getIssues = async function(octokit, context, project, type) {
  // https://docs.github.com/en/rest/reference/issues#list-repository-issues
  core.info(`Listing ${type.toLowerCase()} issues for project ${project}...`);
  const result = await octokit.issues.listForRepo({
    owner: context.repo.owner,
    repo: context.repo.repo,
    labels: `project${project},${type.toLowerCase()}`,
    state: 'all'
  });

  if (result.status != 200) {
    core.info(JSON.stringify(result));
    throw new Error(`unable to list issues`);
  }

  const numbers = result.data.map(x => x.number);
  core.info(`Found Issues: ${numbers.join(', ')}`);
  return result.data;
};

exports.getMilestone = async function(octokit, context, project) {
  // https://docs.github.com/en/rest/reference/issues#list-milestones
  core.info('Listing milestones...');
  const milestones = await octokit.issues.listMilestones({
    owner: context.repo.owner,
    repo: context.repo.repo
  });

  if (milestones.status != 200) {
    core.info(SON.stringify(milestones));
    throw new Error('unable to list milestones');
  }

  const title = `Project ${project}`;
  const found = milestones.data.find(x => x.title == title);

  if (!found) {
    const names = {
      1: 'Inverted Index', 2: 'Partial Search',
      3: 'Multithreading', 4: 'Search Engine'
    };

    const create = await octokit.issues.createMilestone({
      owner: context.repo.owner,
      repo: context.repo.repo,
      title: title,
      state: 'open',
      description: `Project ${project} ${names[project]}`
    });

    if (create.status != 201) {
      core.info(`Result: ${JSON.stringify(create)}`);
      throw new Error(`Unable to create ${title} milestone.`);
    }

    core.info(`Created ${create.data.title} milestone.`);
    return create.data;
  }

  core.info(`Found ${found.title} milestone.`);
  return found;
};

exports.getPullRequests = async function(octokit, context, project, type) {
  // https://docs.github.com/en/rest/reference/pulls#list-pull-requests
  core.info(`Listing ${type.toLowerCase()} issues for project ${project}...`);
  const result = await octokit.pulls.list({
    owner: context.repo.owner,
    repo: context.repo.repo,
    labels: `project${project}`,
    state: 'all'
  });

  if (result.status != 200) {
    core.info(JSON.stringify(result));
    throw new Error(`unable to list pull requests`);
  }

  const numbers = result.data.map(x => x.number);
  core.info(`Found Pull Requests: ${numbers.join(', ')}`);
  return result.data;
};
