/** Local UI inspection only; this switch cannot alter production behaviour. */
export function xPreviewOnly(): boolean {
  return process.env.NODE_ENV === "development" && process.env.LURK_X_PREVIEW_ONLY === "true";
}
