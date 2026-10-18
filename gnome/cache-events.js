export function isUsageCacheEvent(cachePath, changedPath, otherPath = null) {
    if (typeof cachePath !== 'string' || cachePath.length === 0)
        return false;

    return changedPath === cachePath || otherPath === cachePath;
}
