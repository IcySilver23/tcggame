import { applyLocalReleases, localReleaseStatus } from '../../server/services/localcatalog'
const r = applyLocalReleases()
console.log('apply:', r)
console.log('status:', localReleaseStatus())
console.log('second run:', applyLocalReleases())
