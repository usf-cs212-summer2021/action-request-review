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
    utils.showTitle('Request Setup Phase');

    // must do or setup state is lost
    utils.restoreStates(states);

    // -----------------------------------------------
    core.startGroup('Displaying environment setup...');

    await utils.checkExec('java', {
      param: ['--version'],
      title: 'Displaying Java runtime version',
      error: 'Unable to display Java runtime version'
    });

    await utils.checkExec('javac', {
      param: ['--version'],
      title: 'Displaying Java compiler version',
      error: 'Unable to display Java compiler version'
    });

    await utils.checkExec('mvn', {
      param: ['--version'],
      title: 'Displaying Maven version',
      error: 'Unable to display Maven version'
    });

    core.info('');
    core.endGroup();
    // -----------------------------------------------

    // -----------------------------------------------
    core.startGroup('Updating Maven dependencies...');

    status.maven = await utils.checkExec('mvn', {
      param: ['-f', `${utils.mainDir}/pom.xml`, '-ntp', 'dependency:go-offline'],
      error: 'Updating returned non-zero exit code',
    });

    core.info('');
    core.endGroup();
    // -----------------------------------------------

    utils.showTitle('Request Verify Phase');

    // -----------------------------------------------
    core.startGroup('Checking code for warnings...');

    status.mainCompile = await utils.checkExec('mvn', {
      param: ['-ntp', '-DcompileOptionXlint="-Xlint:all"', '-DcompileOptionXdoclint="-Xdoclint:all/private"', '-DcompileOptionFail="true"', '-Dmaven.compiler.showWarnings="true"', 'clean', 'compile'],
      title: 'Compiling project code',
      error: 'Unable to compiling code without warnings. Please address all warnings before requesting code review',
      chdir: `${utils.mainDir}/`
    });

    await utils.checkExec('ls', {
      param: ['-m', `${utils.mainDir}/target/classes`],
      title: 'Listing main class files',
      error: 'Unable to list main class directory',
    });

    core.info('');
    core.endGroup();
    // -----------------------------------------------

    // -----------------------------------------------
    core.startGroup('Checking code for cleanup...');

    status.todoGrep = await utils.checkExec('grep', {
      param: ['-rnoiE', '//\\s*TODO\\b', '.'],
      title: 'Checking for 1 line TODO comments',
      chdir: `${utils.mainDir}/src/main/java`
    });

    if (status.todoGrep != 1) {
      // throw new Error('One or more TODO comments found. Please clean up the code before requesting code review.');
      utils.showWarning('One or more TODO comments found. Please clean up the code before requesting code review.');
    }

    status.mainGrep = await utils.checkExec('grep', {
      param: ['-rnoiE', '--exclude=Driver.java', '\\s*public\\s+static\\s+void\\s+main\\s*\\(', '.'],
      title: 'Checking for extra main methods',
      chdir: `${utils.mainDir}/src/main/java`
    });

    if (status.mainGrep != 1) {
      utils.showWarning('More than one main method found. Please clean up old main methods before requesting code review.');
    }

    core.info('');
    core.endGroup();
    // -----------------------------------------------

    utils.showTitle('Request Aprrove Phase');

    // -----------------------------------------------
    core.startGroup('Creating code review branch...');

    status.branchCommit = await utils.checkExec('git', {
      param: ['commit', '--allow-empty', '-m', `"Creating ${states.branch} branch"`],
      title: 'Creating branch commit',
      error: `Unable to commit ${states.branch} branch`,
      chdir: `${utils.mainDir}/`
    });

    status.branchPush = await utils.checkExec('git', {
      param: ['push', '-u', 'origin', states.branch],
      title: 'Pushing branch to remote',
      error: `Unable to push ${states.branch} branch`,
      chdir: `${utils.mainDir}/`
    });

    core.info('');
    core.endGroup();
    // -----------------------------------------------

    // create pull request

    // update pull request

    throw new Error('This action is not yet implemented. Contact the instructor for instructions on how to request code review.');
  }
  catch (error) {
    utils.showError(`${error.message}\n`); // show error in group
    core.endGroup();  // end group

    // displays outside of group; always visible
    core.setFailed(`Code review request failed. ${error.message}`);
  }
  finally {
    core.startGroup('Logging setup status...');
    core.info(`status: ${JSON.stringify(status)}`);
    core.info(`states: ${JSON.stringify(states)}`);
    core.endGroup();

    utils.checkWarnings('"Request Review"');
  }
}

run();
