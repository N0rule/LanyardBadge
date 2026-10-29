module.exports = async function autoCode(page) {
  await page.addLocatorHandler(page.locator('#pair-dialog'), async () => {
    await page.locator('#pair-code').fill('ABCD');
    await page.locator('#pair-submit').click();
  });
};
