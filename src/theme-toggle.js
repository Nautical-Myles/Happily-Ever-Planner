/* 
 Copyright (C) 2026 Nautical-Myles
 Use of this software is govered by the Business Source License included in the LICENSE.md file and at www.mariadb.com/bsl11.
 Change Date: 1 January 2028
 On the date above, in accordance with the Business Source License, use of this software will be governed by the open source license specified in the LICENSE.md file.
*/

// Version 0.3.8

const uiAppearanceSelect = document.getElementById('ui-appearance-select');
const mapAppearanceSelect = document.getElementById('map-appearance-select');

if (!uiAppearanceSelect || !mapAppearanceSelect) {
  throw new Error('UI or map appearance selector was not found.');
}

const applyAppearance = () => {
  const highContrastEnabled = uiAppearanceSelect.value === 'high-contrast';
  const menuThemeEnabled = uiAppearanceSelect.value === 'storybook';
  const mapThemeEnabled = mapAppearanceSelect.value === 'storybook';

  document.body.classList.toggle('storybook-theme', menuThemeEnabled);
  document.body.classList.toggle('high-contrast', highContrastEnabled);
  document.body.classList.toggle('storybook-map', mapThemeEnabled);
  window.APP.requestRender();
};

uiAppearanceSelect.addEventListener('change', applyAppearance);
mapAppearanceSelect.addEventListener('change', applyAppearance);
applyAppearance();
