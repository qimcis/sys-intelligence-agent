import { e as createComponent, f as createAstro, h as addAttribute, k as renderHead, l as renderSlot, n as renderScript, r as renderTemplate, o as renderComponent, m as maybeRenderHead } from '../chunks/astro/server_C_apge7d.mjs';
import 'piccolore';
import 'clsx';
/* empty css                                 */
export { renderers } from '../renderers.mjs';

const $$Astro = createAstro();
const $$Layout = createComponent(($$result, $$props, $$slots) => {
  const Astro2 = $$result.createAstro($$Astro, $$props, $$slots);
  Astro2.self = $$Layout;
  const { title } = Astro2.props;
  return renderTemplate`<html lang="en"> <head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><meta name="generator"${addAttribute(Astro2.generator, "content")}><title>${title}</title>${renderHead()}</head> <body> <div class="container"> <header> <h1>System Intelligence Benchmark</h1> <button class="theme-toggle" id="theme-toggle" aria-label="Toggle theme"> <svg class="icon-sun" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="5"></circle><line x1="12" y1="1" x2="12" y2="3"></line><line x1="12" y1="21" x2="12" y2="23"></line><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"></line><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"></line><line x1="1" y1="12" x2="3" y2="12"></line><line x1="21" y1="12" x2="23" y2="12"></line><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"></line><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"></line></svg> <svg class="icon-moon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path></svg> </button> </header> <main> ${renderSlot($$result, $$slots["default"])} </main> </div> ${renderScript($$result, "/home/qi/sys-intelligence-agent/src/layouts/Layout.astro?astro&type=script&index=0&lang.ts")} </body> </html>`;
}, "/home/qi/sys-intelligence-agent/src/layouts/Layout.astro", void 0);

const $$Index = createComponent(async ($$result, $$props, $$slots) => {
  return renderTemplate`${renderComponent($$result, "Layout", $$Layout, { "title": "System Intelligence Benchmark", "data-astro-cid-j7pv25f6": true }, { "default": async ($$result2) => renderTemplate` ${maybeRenderHead()}<div id="form-area" data-astro-cid-j7pv25f6> <div class="block" data-astro-cid-j7pv25f6> <div class="block-header" data-astro-cid-j7pv25f6>Configuration</div> <p style="color: var(--muted); font-size: 0.75rem; margin-bottom: 1rem;" data-astro-cid-j7pv25f6>
Configure paths and API key for your local environment.
</p> <label for="repo-path" data-astro-cid-j7pv25f6>Benchmark Repository Path</label> <input type="text" id="repo-path" placeholder="/path/to/system-intelligence-benchmark" data-astro-cid-j7pv25f6> <p style="color: var(--muted); font-size: 0.625rem; margin-top: 0.25rem; margin-bottom: 1rem;" data-astro-cid-j7pv25f6>
Local path to the cloned system-intelligence-benchmark repository
</p> <label for="api-key" data-astro-cid-j7pv25f6>OpenAI API Key</label> <input type="text" id="api-key" placeholder="sk-..." data-astro-cid-j7pv25f6> <div style="margin-top: 1.5rem; padding-top: 1rem; border-top: 1px solid var(--border);" data-astro-cid-j7pv25f6> <div style="font-size: 0.875rem; font-weight: 500; margin-bottom: 0.25rem;" data-astro-cid-j7pv25f6>GitHub Integration (Optional)</div> <p style="color: var(--muted); font-size: 0.625rem; margin-bottom: 1rem;" data-astro-cid-j7pv25f6>
Auto-create branches and push commits
</p> <label for="github-username" data-astro-cid-j7pv25f6>GitHub Username</label> <input type="text" id="github-username" placeholder="your-username" data-astro-cid-j7pv25f6> <label for="github-token" data-astro-cid-j7pv25f6>GitHub Personal Access Token</label> <input type="text" id="github-token" placeholder="ghp_..." data-astro-cid-j7pv25f6> <p style="color: var(--muted); font-size: 0.625rem; margin-top: 0.25rem; margin-bottom: 1rem;" data-astro-cid-j7pv25f6>
Token needs repo write permissions. Creates branches and pushes commits automatically.
</p> </div> <button id="save-config" data-astro-cid-j7pv25f6>Save Configuration</button> <div id="config-status" class="status" style="display: none;" data-astro-cid-j7pv25f6></div> </div> <div class="block" data-astro-cid-j7pv25f6> <div class="block-header" data-astro-cid-j7pv25f6>Default Metadata</div> <p style="color: var(--muted); font-size: 0.75rem; margin-bottom: 1rem;" data-astro-cid-j7pv25f6>
These values apply to all exams uploaded in this session.
</p> <div class="row" data-astro-cid-j7pv25f6> <div style="flex: 1;" data-astro-cid-j7pv25f6> <label for="default-institution" data-astro-cid-j7pv25f6>Institution</label> <input type="text" id="default-institution" placeholder="University of Wisconsin-Madison" data-astro-cid-j7pv25f6> </div> <div style="flex: 1;" data-astro-cid-j7pv25f6> <label for="default-course" data-astro-cid-j7pv25f6>Course</label> <input type="text" id="default-course" placeholder="CS 537" data-astro-cid-j7pv25f6> </div> </div> </div> <div class="block" data-astro-cid-j7pv25f6> <div class="block-header" data-astro-cid-j7pv25f6>Upload Exam Files</div> <p style="color: var(--muted); font-size: 0.75rem; margin-bottom: 1rem;" data-astro-cid-j7pv25f6>
Upload multiple exam and solution files. AI will automatically match them and process in parallel.
</p> <div class="file-input" id="files-dropzone" style="min-height: 120px;" data-astro-cid-j7pv25f6> <span data-astro-cid-j7pv25f6>Click or drag to upload exam and solution files</span> <input type="file" id="files-input" accept=".pdf,.txt" multiple data-astro-cid-j7pv25f6> <div class="file-name" id="files-list" data-astro-cid-j7pv25f6></div> </div> </div> <div class="block" data-astro-cid-j7pv25f6> <div class="block-header" data-astro-cid-j7pv25f6>Additional Notes</div> <label for="notes" data-astro-cid-j7pv25f6>Notes for AI Processing</label> <textarea id="notes" placeholder="Any specific instructions for parsing the exams (e.g., 'Questions 1-5 are multiple choice', 'Skip questions with figures')" data-astro-cid-j7pv25f6></textarea> </div> <button id="process-btn" style="width: 100%;" data-astro-cid-j7pv25f6>Process and Add Exam(s)</button> </div> <div id="processing-area" style="display: none;" data-astro-cid-j7pv25f6> <div id="sorting-status" class="status loading" style="display: none;" data-astro-cid-j7pv25f6>Matching files...</div> <div id="exam-groups" style="margin-bottom: 1rem;" data-astro-cid-j7pv25f6></div> <div id="process-status" class="status loading" style="display: none;" data-astro-cid-j7pv25f6>Processing...</div> <div id="exam-logs" data-astro-cid-j7pv25f6></div> </div>  ${renderScript($$result2, "/home/qi/sys-intelligence-agent/src/pages/index.astro?astro&type=script&index=0&lang.ts")} ` })}`;
}, "/home/qi/sys-intelligence-agent/src/pages/index.astro", void 0);

const $$file = "/home/qi/sys-intelligence-agent/src/pages/index.astro";
const $$url = "";

const _page = /*#__PURE__*/Object.freeze(/*#__PURE__*/Object.defineProperty({
  __proto__: null,
  default: $$Index,
  file: $$file,
  url: $$url
}, Symbol.toStringTag, { value: 'Module' }));

const page = () => _page;

export { page };
