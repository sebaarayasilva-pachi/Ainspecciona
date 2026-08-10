/* Postventa: conversación WebRTC con @elevenlabs/client + client tools. */
(function () {
  "use strict";

  var SDK_URL = "https://cdn.jsdelivr.net/npm/@elevenlabs/client@1.0.0/+esm";
  var sdkPromise = null;
  var conversation = null;

  function loadSdk() {
    if (!sdkPromise) {
      sdkPromise = import(SDK_URL).catch(function (e) {
        sdkPromise = null;
        throw e;
      });
    }
    return sdkPromise;
  }

  async function start(opts) {
    opts = opts || {};
    var mod = await loadSdk();
    var Conversation = mod.Conversation;
    conversation = await Conversation.startSession({
      agentId: opts.agentId,
      connectionType: "webrtc",
      dynamicVariables: opts.dynamicVariables || {},
      clientTools: opts.clientTools || {},
      onConnect: opts.onConnect || function () {},
      onDisconnect: function () {
        conversation = null;
        if (typeof opts.onDisconnect === "function") opts.onDisconnect();
      },
      onError: opts.onError || function () {},
      onModeChange: opts.onModeChange || function () {},
      onStatusChange: opts.onStatusChange || function () {},
    });
    return conversation;
  }

  async function stop() {
    if (!conversation) return;
    try {
      await conversation.endSession();
    } catch (e) {
      /* noop */
    }
    conversation = null;
  }

  function isActive() {
    return !!conversation;
  }

  function getConversation() {
    return conversation;
  }

  window.PostventaVoice = { start: start, stop: stop, isActive: isActive, getConversation: getConversation };
})();
