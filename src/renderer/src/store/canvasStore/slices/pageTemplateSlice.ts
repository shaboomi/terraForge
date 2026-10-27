import { pushCanvasUndo } from "../services/history";
import { BUILT_IN_PAGE_SIZES } from "../../../../../types";
import type { CanvasStateCreator, PageTemplateSlice } from "../types";

export const createPageTemplateSlice: CanvasStateCreator<PageTemplateSlice> = (
  set,
  get,
) => ({
  pageTemplate: null,
  pageSizes: BUILT_IN_PAGE_SIZES,

  setPageTemplate: (template) => {
    if (JSON.stringify(get().pageTemplate) === JSON.stringify(template)) return;
    pushCanvasUndo(set, get);
    set((state) => { state.pageTemplate = template; });
  },

  setPageSizes: (sizes) =>
    set((state) => {
      state.pageSizes = sizes;
    }),
});
