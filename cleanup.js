const core = require('@actions/core');
const cache = require('@actions/cache');
const utils = require('./utils.js');

async function run() {
  const status = {}; // status of intermediate steps
  const states = {}; // things to remember between pre/main/post

  utils.restoreStates(states);

  try {
    // -----------------------------------------------
    core.startGroup('Saving Maven cache...');

    if ('mavenKey' in states) {
      if ('mavenCache' in states && states.mavenKey === states.mavenCache) {
        core.info(`Skipping; cache already exists.`);
      }
      else {
        core.info(`Saving ${states.mavenKey} to cache...`);
        status.mavenCache = await cache.saveCache(['~/.m2'], states.mavenKey);
        core.info(`Saved cache: ${status.mavenCache}`);
      }
    }
    else {
      core.info('Unable to cache; key not found');
    }

    core.info('');
    core.endGroup();
    // -----------------------------------------------
  }
  catch (error) {
    core.endGroup();
    utils.showWarning(`Encountered issues saving cache. ${error.message}`);
  }
  finally {
    core.startGroup('Logging cleanup status...');
    core.info(`status: ${JSON.stringify(status)}`);
    core.info(`states: ${JSON.stringify(states)}`);
    core.endGroup();

    utils.checkWarnings('"Post Request Review"');
  }
}

run();
