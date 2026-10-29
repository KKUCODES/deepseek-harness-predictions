// src/config.ts
var TEST_TEXT = "\uFF3B\u63A5\u5165\u6D4B\u8BD5\uFF3D\u8BF7\u7EE7\u7EED\u8BF4\u660E\u4E0B\u4E00\u6B65\u3002";
var PACKAGE_NAME = "@kkucodes/dsh-predictions";
var ENTRY_ID = "dsh-predictions";
var RPC_CHANNEL = "/api";
var RPC_PREFIX = "dsh-predictions/";
var PROJECTION_KEY = "dshPredictions";
var CUSTOM_ROUTE = '["dsh-predictions-custom","configured"]';
var DEFAULTS = {
  automaticEnabled: true,
  modelRoute: "",
  contextMessages: 8,
  contextChars: 4e3,
  outputTokens: 128,
  inputPrice: 0,
  outputPrice: 0
};
function validTestText(value) {
  if (typeof value !== "string" || /[\r\n\u0000]/u.test(value)) return void 0;
  const text = value.trim();
  return text.length > 0 && Array.from(text).length <= 240 ? text : void 0;
}
export {
  CUSTOM_ROUTE,
  DEFAULTS,
  ENTRY_ID,
  PACKAGE_NAME,
  PROJECTION_KEY,
  RPC_CHANNEL,
  RPC_PREFIX,
  TEST_TEXT,
  validTestText
};
//# sourceMappingURL=config.js.map
