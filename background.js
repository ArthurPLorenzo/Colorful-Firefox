"use strict";

// Action has no popup — clicking the toolbar button opens the options page.
browser.action.onClicked.addListener(() => {
  browser.runtime.openOptionsPage();
});
