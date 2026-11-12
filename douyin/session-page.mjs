// The login tab can be closed while other identity tabs keep Edge connected.
// Recreate only that tab, retaining the context and its authenticated storage.
export async function ensureLoginPage(context, page, observe) {
 if(page&&!page.isClosed())return page;
 const replacement=await context.newPage();
 observe(replacement);
 return replacement;
}
