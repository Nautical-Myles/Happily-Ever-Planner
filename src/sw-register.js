/* 
 Copyright (C) 2026 Nautical-Myles
 Use of this software is govered by the Business Source License included in the LICENSE.md file and at www.mariadb.com/bsl11.
 Change Date: 1 January 2028
 On the date above, in accordance with the Business Source License, use of this software will be governed by the open source license specified in the LICENSE.md file.
*/

// Version 0.2.6

if ('serviceWorker' in navigator) {
      window.addEventListener('load', () => {
        navigator.serviceWorker.register('./sw.js')
          .then(registration => {
            console.log('ServiceWorker registered successfully with scope: ', registration.scope);
          })
          .catch(error => {
            console.log('ServiceWorker registration failed: ', error);
          });
      });
    }