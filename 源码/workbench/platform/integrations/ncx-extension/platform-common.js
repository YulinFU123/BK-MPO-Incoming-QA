/* Additive settings; no change to the protected extension's selectors/rules. */
(() => {
  const load = NCX.loadSettings;
  NCX.loadSettings = async () => {
    const settings = await load(),
      { platformBridge } = await chrome.storage.local.get('platformBridge');
    return platformBridge?.enabled
      ? { ...settings, workMode: 'B', watchSubfolder: 'BK_MPO_Inbox', platformBridge: true }
      : settings;
  };
  NCX.VERSION = '1.5.0';
})();
