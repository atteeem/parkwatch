// Reference to a private storage object, as carried in evidence `uri` fields
// before it is resolved to a short-lived signed URL. Never a public URL.
export const STORAGE_URI_SCHEME = "parkwatch-storage://";

export const isStorageReference = (uri: string | undefined | null): boolean => !!uri && uri.startsWith(STORAGE_URI_SCHEME);
