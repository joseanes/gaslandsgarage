// print-new.js - A new approach with pre-rendered HTML string
(function() {
  document.addEventListener('DOMContentLoaded', function() {
    console.log('[print-new] Initializing dedicated print handler');
    
    // Store original print function
    const originalPrint = window.print;
    
    // Override window.print
    window.print = function() {
      console.log('[print-new] Print requested, creating dedicated print page');
      
      try {
        // Get the data needed for printing
        const teamName = document.querySelector('h1')?.textContent || 'Gaslands Team';
        const totalCans = document.querySelector('.team-cans')?.textContent || '0';
        const maxCans = document.querySelector('.team-max-cans')?.textContent || '50';
        const sponsorName = document.querySelector('.team-sponsor')?.textContent || 'No Sponsor';
        
        // Try to get QR code if it exists
        let qrCode = '';
        const qrCodeImg = /** @type {HTMLImageElement | null} */ (document.getElementById('print-qr-code'));
        if (qrCodeImg && qrCodeImg.src) {
          qrCode = qrCodeImg.src;
        }
        
        // Get vehicle cards HTML
        let vehicleCardsHtml = '';
        const vehicleCards = document.querySelectorAll('.vehicle-card');
        vehicleCards.forEach(card => {
          vehicleCardsHtml += generateVehicleCardHtml(card);
        });
        
        // Create a new window for printing
        const printWindow = window.open('', '_blank', 'width=800,height=600');
        
        if (!printWindow) {
          alert('Please allow popups for printing');
          return;
        }
        
        // Generate complete HTML for the print window
        const printHtml = `
        <!DOCTYPE html>
        <html>
        <head>
          <title>Gaslands Team: ${teamName}</title>
          <meta charset="utf-8">
          <style>
            body {
              font-family: Arial, sans-serif;
              margin: 0;
              padding: 20px;
              color: black;
              background-color: white;
            }
            
            /* Print-specific page settings */
            @media print {
              @page {
                size: auto;
                margin: 10mm;
              }
              
              body {
                -webkit-print-color-adjust: exact !important;
                print-color-adjust: exact !important;
              }
            }
            
            /* Header styles */
            .print-header {
              margin-bottom: 20px;
              border-bottom: 2px solid #d97706;
              padding-bottom: 10px;
            }
            
            h1 {
              color: #d97706;
              font-size: 24px;
              margin: 0 0 10px 0;
            }
            
            .team-info {
              display: flex;
              justify-content: space-between;
            }
            
            /* Vehicle card grid */
            .vehicle-cards {
              display: grid;
              grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
              gap: 20px;
              margin-bottom: 30px;
            }
            
            /* Individual vehicle card */
            .vehicle-card {
              border: 1px solid #888;
              border-radius: 8px;
              padding: 15px;
              page-break-inside: avoid;
            }
            
            .card-header {
              display: flex;
              justify-content: space-between;
              margin-bottom: 15px;
              border-bottom: 1px solid #eee;
              padding-bottom: 8px;
            }
            
            .vehicle-name {
              font-weight: bold;
              font-size: 1.2em;
            }
            
            .vehicle-type {
              display: inline-block;
              background-color: #333;
              color: white;
              padding: 3px 8px;
              border-radius: 4px;
              font-size: 0.8em;
            }
            
            .vehicle-cost {
              background-color: black;
              color: white;
              padding: 2px 8px;
              border-radius: 4px;
              font-weight: bold;
              text-align: center;
            }
            
            /* Stats section */
            .stats-section {
              margin-bottom: 15px;
            }
            
            .stats-grid {
              display: grid;
              grid-template-columns: repeat(4, 1fr);
              gap: 10px;
            }
            
            .stat-item {
              text-align: center;
            }
            
            .stat-label {
              font-size: 0.8em;
              display: block;
              margin-bottom: 2px;
            }
            
            .stat-value {
              font-weight: bold;
            }
            
            /* Hull tracker */
            .hull-track {
              margin-bottom: 15px;
            }
            
            .hull-boxes {
              display: flex;
              gap: 2px;
            }
            
            .hull-box {
              width: 15px;
              height: 15px;
              border: 1px solid black;
            }
            
            /* Loadout sections */
            .loadout-section {
              margin-bottom: 10px;
            }
            
            .section-title {
              font-weight: bold;
              margin-bottom: 5px;
              border-bottom: 1px solid #eee;
            }
            
            ul {
              margin: 0;
              padding-left: 20px;
            }
            
            li {
              margin-bottom: 2px;
            }
            
            /* QR code section */
            .qr-section {
              text-align: center;
              margin-top: 30px;
              page-break-before: always;
            }
            
            .qr-code {
              max-width: 150px;
              height: auto;
              margin: 0 auto;
            }
            
            .qr-caption {
              margin-top: 10px;
              font-size: 0.9em;
              color: #666;
            }
            
            /* Footer */
            .print-footer {
              margin-top: 20px;
              text-align: center;
              font-size: 0.8em;
              color: #666;
            }
          </style>
        </head>
        <body>
          <div class="print-header">
            <h1>${teamName}</h1>
            <div class="team-info">
              <div>Total: ${totalCans} / ${maxCans} cans</div>
              <div>Sponsor: ${sponsorName}</div>
            </div>
          </div>
          
          <div class="vehicle-cards">
            ${vehicleCardsHtml}
          </div>
          
          <div class="qr-section">
            ${qrCode ? `<img src="${qrCode}" class="qr-code" alt="QR Code for team">` : ''}
            <div class="qr-caption">Scan to load this team build</div>
          </div>
          
          <div class="print-footer">
            Generated by Gaslands Garage on ${new Date().toLocaleDateString()}
          </div>
        </body>
        </html>
        `;
        
        // Write HTML to the print window
        printWindow.document.write(printHtml);
        printWindow.document.close();
        
        // Print after a short delay to ensure content is rendered
        setTimeout(() => {
          try {
            printWindow.print();
            
            // Close window after printing (or after a timeout if printing is canceled)
            setTimeout(() => {
              printWindow.close();
            }, 2000);
          } catch (error) {
            console.error('[print-new] Error during printing:', error);
            setTimeout(() => {
              printWindow.close();
            }, 1000);
          }
        }, 500);
        
      } catch (error) {
        console.error('[print-new] Error preparing print:', error);
        alert('There was an error preparing your print. Please try again.');
        // Fallback to original print
        originalPrint.call(window);
      }
    };
    
    // Helper function to generate HTML for a vehicle card
    /** @param {Element} card */
    function generateVehicleCardHtml(card) {
      try {
        // Extract vehicle name
        const name = card.querySelector('.vehicle-name')?.textContent || 'Vehicle';
        
        // Extract vehicle type
        const type = card.querySelector('.vehicle-type')?.textContent || 'Car';
        
        // Extract vehicle cost
        const cost = card.querySelector('.vehicle-cost')?.textContent || '0';
        
        // Extract stats
        const handling = card.querySelector('.stat-handling')?.textContent || '4';
        const gear = card.querySelector('.stat-gear')?.textContent || '6';
        const crew = card.querySelector('.stat-crew')?.textContent || '1';
        const weight = card.querySelector('.stat-weight')?.textContent || 'Medium';
        
        // Extract hull count
        const hull = card.querySelectorAll('.hull-box')?.length || 4;
        
        // Extract weapons
        let weaponsHtml = '';
        const weapons = card.querySelectorAll('.weapon-item');
        if (weapons && weapons.length > 0) {
          weaponsHtml = '<div class="loadout-section"><div class="section-title">Weapons</div><ul>';
          weapons.forEach((/** @type {Element} */ weapon) => {
            weaponsHtml += `<li>${weapon.textContent}</li>`;
          });
          weaponsHtml += '</ul></div>';
        }
        
        // Extract upgrades
        let upgradesHtml = '';
        const upgrades = card.querySelectorAll('.upgrade-item');
        if (upgrades && upgrades.length > 0) {
          upgradesHtml = '<div class="loadout-section"><div class="section-title">Upgrades</div><ul>';
          upgrades.forEach((/** @type {Element} */ upgrade) => {
            upgradesHtml += `<li>${upgrade.textContent}</li>`;
          });
          upgradesHtml += '</ul></div>';
        }
        
        // Extract perks
        let perksHtml = '';
        const perks = card.querySelectorAll('.perk-item');
        if (perks && perks.length > 0) {
          perksHtml = '<div class="loadout-section"><div class="section-title">Perks</div><ul>';
          perks.forEach((/** @type {Element} */ perk) => {
            perksHtml += `<li>${perk.textContent}</li>`;
          });
          perksHtml += '</ul></div>';
        }
        
        // Generate hull boxes HTML
        let hullBoxesHtml = '';
        for (let i = 0; i < hull; i++) {
          hullBoxesHtml += '<div class="hull-box"></div>';
        }
        
        // Return complete vehicle card HTML
        return `
        <div class="vehicle-card">
          <div class="card-header">
            <div>
              <div class="vehicle-name">${name}</div>
              <div class="vehicle-type">${type}</div>
            </div>
            <div class="vehicle-cost">${cost} cans</div>
          </div>
          
          <div class="hull-track">
            <div class="stat-label">Hull</div>
            <div class="hull-boxes">${hullBoxesHtml}</div>
          </div>
          
          <div class="stats-section">
            <div class="stats-grid">
              <div class="stat-item">
                <span class="stat-label">Handling</span>
                <span class="stat-value">${handling}</span>
              </div>
              <div class="stat-item">
                <span class="stat-label">Gear</span>
                <span class="stat-value">${gear}</span>
              </div>
              <div class="stat-item">
                <span class="stat-label">Crew</span>
                <span class="stat-value">${crew}</span>
              </div>
              <div class="stat-item">
                <span class="stat-label">Weight</span>
                <span class="stat-value">${weight}</span>
              </div>
            </div>
          </div>
          
          ${weaponsHtml}
          ${upgradesHtml}
          ${perksHtml}
        </div>
        `;
      } catch (error) {
        console.error('[print-new] Error generating vehicle card:', error);
        return '<div class="vehicle-card">Error generating vehicle card</div>';
      }
    }
    
    console.log('[print-new] Print handler initialized');
  });
})();