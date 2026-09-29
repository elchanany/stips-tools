$@
const originalFetch = window.fetch;
window.fetch = async function() {
  const response = await originalFetch.apply(this, arguments);
  const url = arguments[0];
  
  if (url && url.includes('profile.page_data')) {
    const clonedResponse = response.clone();
    try {
        const data = await clonedResponse.json();
        const userid = JSON.parse(decodeURIComponent(new URL(url).searchParams.get('api_params'))).userid;
        
        // Change the data only if it is the user's own profile 
        if (userid === 429329) {
            if (!Array.isArray(data.data.badges)) {
                 data.data.badges = [];
            }
            if (!data.data.badges.some(b => b.name === 'moderator')) {
                 data.data.badges.push({ name: 'moderator' });
            }
            if(data.data.user_profile_page && data.data.user_profile_page.meta && data.data.user_profile_page.meta.permissions) {
                data.data.user_profile_page.meta.permissions.edit = true;
                data.data.user_profile_page.meta.permissions.delete = true;
                data.data.user_profile_page.meta.permissions.ban = true;
                data.data.user_profile_page.meta.permissions.report = true;
            }
            return new Response(JSON.stringify(data), {
              status: response.status,
              statusText: response.statusText,
              headers: response.headers
            });
        }
    } catch(e) {
        // Ignore JSON parse errors for non-json responses
    }
  }
  
  return response;
};
@
