const donationSuggestion = document.createElement('button');
donationSuggestion.type = 'button';
donationSuggestion.id = 'donation-suggestion';
donationSuggestion.className = 'donation-suggestion';
donationSuggestion.textContent = '捐贈 2995 · 按 Enter 或點選套用';
donationSuggestion.hidden = true;
invoiceDonateCarrierInput.after(donationSuggestion);
invoiceDonateCarrierInput.setAttribute('aria-controls', donationSuggestion.id);
const updateDonationSuggestion = () => {
  donationSuggestion.hidden = !/^29(?:9)?$/.test(
    invoiceDonateCarrierInput.value.trim(),
  );
};
const chooseDonationSuggestion = () => {
  invoiceDonateCarrierInput.value = '2995';
  donationSuggestion.hidden = true;
  invoiceDonateCarrierInput.dispatchEvent(
    new Event('input', { bubbles: true }),
  );
  invoiceDonateCarrierInput.dispatchEvent(
    new Event('change', { bubbles: true }),
  );
};
donationSuggestion.addEventListener('pointerdown', (event) =>
  event.preventDefault(),
);
donationSuggestion.addEventListener('click', chooseDonationSuggestion);
invoiceDonateCarrierInput.addEventListener('input', updateDonationSuggestion);
invoiceDonateCarrierInput.addEventListener('focus', updateDonationSuggestion);
invoiceDonateCarrierInput.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && !donationSuggestion.hidden) {
    event.preventDefault();
    chooseDonationSuggestion();
  } else if (event.key === 'Escape') donationSuggestion.hidden = true;
});
invoiceTaxIdInput.addEventListener('input', () => {
  donationSuggestion.hidden = true;
});
