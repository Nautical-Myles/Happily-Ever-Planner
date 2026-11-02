/* 
 Copyright (C) 2026 Nautical-Myles
 Use of this software is govered by the Business Source License included in the LICENSE.md file and at www.mariadb.com/bsl11.
 Change Date: 1 January 2028
 On the date above, in accordance with the Business Source License, use of this software will be governed by the open source license specified in the LICENSE.md file.
*/

// Version 0.2.6

// Auto-pull version from document header comments
for (let node of document.childNodes) {
  if (node.nodeType === 8 && node.nodeValue.includes('Version')) {
    document.getElementById('app-version').textContent = node.nodeValue.trim();
    break;
  }
}