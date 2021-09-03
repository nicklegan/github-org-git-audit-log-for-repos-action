const arraySort = require('array-sort')
const core = require('@actions/core')
const github = require('@actions/github')
const stringify = require('csv-stringify/lib/sync')

const token = core.getInput('token', {required: true})
const octokit = github.getOctokit(token)

const eventPayload = require(process.env.GITHUB_EVENT_PATH)
const org = core.getInput('org', {required: false}) || eventPayload.organization.login

const days = core.getInput('days', {required: false}) || '7'
const fromDate = Date.now() - days * 24 * 60 * 60 * 1000

;(async () => {
  try {
    const dataArray = []
    const gitArray = []

    // Retrieve Git audit-log data
    const data = await octokit.paginate('GET /orgs/{org}/audit-log', {
      org: org,
      include: 'git'
    })

    console.log(`Retrieve Git audit log for ${days} days starting at ${new Date(fromDate)}`)

    data.forEach((element) => {
      if (element['@timestamp'] >= fromDate) {
        dataArray.push(element)
      }
    })

    // Sum and sort Git audit log data per repository
    const gitSum = dataArray.reduce((res, {repo, action}) => {
      res[repo] = {
        ...res[repo],
        [action]: 1 + (res[repo] && res[repo][action] ? res[repo][action] : 0)
      }
      return res
    }, {})

    const gitMap = Object.keys(gitSum).map((key) => {
      return {
        repo: key,
        ...gitSum[key]
      }
    })

    gitMap.forEach((element) => {
      const repoName = element['repo'].split('/').pop()
      const gitClone = element['git.clone'] || 0
      const gitPush = element['git.push'] || 0
      const gitFetch = element['git.fetch'] || 0

      console.log(`${repoName} ## Clones: ${gitClone}, Pushes: ${gitPush}, Fetches: ${gitFetch}`)

      gitArray.push({repoName, gitClone, gitPush, gitFetch})
    })
    await pushAuditReport(gitArray)
  } catch (error) {
    core.setFailed(error.message)
  }
})()

async function pushAuditReport(gitArray) {
  try {
    // Set sorting settings and add header to array
    const columns = {
      repoName: 'Repository',
      gitClone: `Git clones (<${days} days)`,
      gitPush: `Git pushes (<${days} days)`,
      gitFetch: `Git fetches (<${days} days)`
    }
    const sortColumn = core.getInput('sort', {required: false}) || 'gitClone'
    const sortArray = arraySort(gitArray, sortColumn, {reverse: true})
    sortArray.unshift(columns)

    // Convert array to csv
    const csv = stringify(sortArray)

    // Prepare path/filename, repo/org context and commit name/email variables
    const reportPath = `reports/${org}-${new Date().toISOString().substring(0, 19) + 'Z'}-${days}days.csv`
    const committerName = core.getInput('committer-name', {required: false}) || 'github-actions'
    const committerEmail = core.getInput('committer-email', {required: false}) || 'github-actions@github.com'
    const {owner, repo} = github.context.repo

    // Push csv to repo
    const opts = {
      owner,
      repo,
      path: reportPath,
      message: `${new Date().toISOString().slice(0, 10)} Git audit log report`,
      content: Buffer.from(csv).toString('base64'),
      committer: {
        name: committerName,
        email: committerEmail
      }
    }

    console.log(`Pushing final CSV report to repository path: ${reportPath}`)

    await octokit.rest.repos.createOrUpdateFileContents(opts)
  } catch (error) {
    core.setFailed(error.message)
  }
}
