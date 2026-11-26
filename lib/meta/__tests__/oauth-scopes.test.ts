/** The Facebook OAuth scopes: pages_manage_metadata is in the default (M3c); FACEBOOK_OAUTH_SCOPES still overrides it. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_FACEBOOK_OAUTH_SCOPES, facebookOAuthScopes } from "../oauth-scopes.ts";

test("default scopes add pages_manage_metadata to the six", () => {
  assert.deepEqual(DEFAULT_FACEBOOK_OAUTH_SCOPES.split(","), ["pages_show_list", "pages_read_engagement", "ads_management", "ads_read", "instagram_basic", "business_management", "pages_manage_metadata"]);
  assert.equal(facebookOAuthScopes({}), DEFAULT_FACEBOOK_OAUTH_SCOPES);
  assert.equal(facebookOAuthScopes({ FACEBOOK_OAUTH_SCOPES: " ads_read,business_management " }), "ads_read,business_management");
});
