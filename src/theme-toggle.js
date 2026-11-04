/* 
 Copyright (C) 2026 Nautical-Myles
 Use of this software is govered by the Business Source License included in the LICENSE.md file and at www.mariadb.com/bsl11.
 Change Date: 1 January 2028
 On the date above, in accordance with the Business Source License, use of this software will be governed by the open source license specified in the LICENSE.md file.
*/

// Version 0.3.0

const appearanceSelect = document.getElementById('appearance-select');

if (!appearanceSelect) {
  throw new Error('Appearance selector was not found.');
}

const applyAppearance = () => {
  const selection = appearanceSelect.value;
  const menuThemeEnabled = selection === 'menus' || selection === 'all';
  const mapThemeEnabled = selection === 'map' || selection === 'all';

  document.body.classList.toggle('storybook-theme', menuThemeEnabled);
  document.body.classList.toggle('storybook-map', mapThemeEnabled);
  window.APP.requestRender();
};

appearanceSelect.addEventListener('change', applyAppearance);
applyAppearance();
