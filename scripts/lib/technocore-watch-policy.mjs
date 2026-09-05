// Observation only: selecting a tag never authorizes runtime adoption.
export function selectObservedTag(publishedTag, liveVersion) {
  const version = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
  if (typeof publishedTag !== 'string' || publishedTag !== publishedTag.trim() || !publishedTag.startsWith('v') ||
      !version.test(publishedTag.slice(1))) throw new Error('Malformed published tag');
  if (liveVersion === null) return publishedTag;
  if (typeof liveVersion !== 'string' || liveVersion !== liveVersion.trim() || liveVersion.length > 64 || !version.test(liveVersion)) {
    throw new Error('Malformed deployed version');
  }
  const published = publishedTag.slice(1).split('.').map(BigInt);
  const deployed = liveVersion.split('.').map(BigInt);
  for (let index = 0; index < 3; index += 1) {
    if (deployed[index] > published[index]) return `v${liveVersion}`;
    if (deployed[index] < published[index]) return publishedTag;
  }
  return publishedTag;
}
