import { checkForUpdate, latestRelease, compareVersions } from '../server/services/updater'

const main = async () => {
  const release = await latestRelease(true)
  console.log('release:', JSON.stringify(release))
  const old = await checkForUpdate('0.77.0')
  console.log('old save 0.77.0 ->', JSON.stringify(old))
  const current = await checkForUpdate('0.77.68')
  console.log('current 0.77.68 ->', JSON.stringify(current))
  console.log('compare 0.77.66.0 vs 0.77.66 =', compareVersions('0.77.66.0', '0.77.66'))
  if (!release) { console.log('FAIL: no release read'); process.exit(1) }
  if (release.version !== '0.77.66') { console.log('FAIL: unexpected version'); process.exit(1) }
  if (!release.setup || !/^TCG-Life-Setup-.*\.exe$/i.test(release.setup.name) || release.setup.size < 1_000_000) {
    console.log('FAIL: setup asset not picked'); process.exit(1)
  }
  if (!old.available || old.version !== '0.77.66' || old.source !== 'github' || !old.pageUrl) {
    console.log('FAIL: older version was not offered'); process.exit(1)
  }
  if (current.available) { console.log('FAIL: current version offered an update'); process.exit(1) }
  console.log('PASS')
}
main()
