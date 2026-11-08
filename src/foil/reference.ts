// Reference photographs for the inspector's side-by-side view.
//
// A flat scan is NOT a reference for relief: it does not contain the foil or its
// texture, so it can neither confirm nor deny the modelled normal map. This
// registry therefore accepts tilted photographs only, and it ships empty because
// none has been catalogued here. The inspector falls back to the flat scan as a
// base-layer reference and says plainly what that cannot show.

export type ReferencePhoto = {
  cardId: string
  /** Image path, served from /public. */
  src: string
  /** Always a tilted photograph: a flat scan cannot show relief. */
  kind: 'tilted-photo'
  credit: string
  /** What the photograph is evidence for, and what it is not. */
  note: string
}

export const REFERENCE_PHOTOS: ReferencePhoto[] = []

export function referenceFor(cardId: string): ReferencePhoto | null {
  return REFERENCE_PHOTOS.find((r) => r.cardId === cardId) ?? null
}

/** Caption for the reference pane; never implies a scan proves the relief. */
export function referenceCaption(cardId: string): string {
  const photo = referenceFor(cardId)
  if (photo) return `Tilted photograph — ${photo.credit}. ${photo.note}`
  return `No tilted photograph is catalogued for ${cardId}. This pane shows the flat scan as the base-layer reference; a flat scan carries no foil, so it cannot confirm the relief's depth or direction.`
}
