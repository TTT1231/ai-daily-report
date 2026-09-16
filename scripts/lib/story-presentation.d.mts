export function sceneHasEvidence(scene: {overlayImg?: string} | null | undefined): boolean;
export function storyShowsTabCards(story: {scenes?: {overlayImg?: string}[]} | null | undefined): boolean;
export function reportUsesEvidenceOnly(report: {stories?: {scenes?: {overlayImg?: string}[]}[]} | null | undefined): boolean;
