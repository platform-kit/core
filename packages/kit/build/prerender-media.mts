export function preserveMutedMedia() {
  document.querySelectorAll<HTMLMediaElement>('audio, video').forEach((media) => {
    media.toggleAttribute('muted', media.muted)
  })
}
