/**
 * Detail pages take their id as `?id=` instead of a path segment, so the whole
 * site can be exported as static files and served from GitHub Pages.
 */
const withId = (path: string, id: string | undefined) => `${path}?id=${encodeURIComponent(id ?? '')}`;

export const listingPath = (id: string | undefined) => withId('/listings/view', id);
export const chatPath = (orderId: string | undefined) => withId('/messages/view', orderId);
export const userPath = (id: string | undefined) => withId('/users/view', id);
export const wantPath = (id: string | undefined) => withId('/wants/view', id);

/** Set at build time when the site lives in a subfolder (e.g. /myrs on GitHub Pages). */
export const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? '';

/** Plain <img> tags and window URLs do not get the base path added by Next; this does. */
export const asset = (path: string) => `${BASE_PATH}${path}`;
