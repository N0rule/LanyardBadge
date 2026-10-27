# Physical acceptance checklist

Automated and serial measurements are recorded in VERIFICATION.md. Check these
on the actual 240 × 320 ST7789 with USB connectors at the bottom:

- [ ] Artwork upright, fills the screen, red/green/blue channels look correct.
- [ ] Hold opens menu; swipes switch cards; a hold never also switches a card.
- [ ] Default mapping works at all corners without running calibration.
- [ ] Menu taps feel immediate; settings update without jumping scroll position.
- [ ] QR is centered, has clear white margin, and scans from a real phone.
- [ ] Brightness steps appear sensible, including the 5% minimum.
- [ ] After timeout, the physical backlight is completely off.
- [ ] First touch wakes only; a second touch performs the intended action.
- [ ] Slideshow pauses while dark and restarts its interval after wake.
- [ ] No continuous redrawing of static art; assess tearing during transitions.
- [ ] Boot recovery opens connection at 2 seconds, calibration at 6 seconds.
- [ ] Real phone Web Bluetooth discovery/pair/upload/reconnect works.
- [ ] Browser USB update completes with Erase unchecked and retains cards.

Fresh-install formatting must only be tested on an entirely blank asset partition.
Do not erase a populated device merely to check first-boot onboarding. Deliberate
power cuts/corruption require an explicit backed-up test setup and are not claimed
by ordinary restart tests.
