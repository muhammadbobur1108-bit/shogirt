import { test, expect } from '@playwright/test';

async function openSkladGrid(page: import('@playwright/test').Page) {
  await page.addInitScript(() => {
    const owner = {
      id: 'usr-owner',
      username: 'muhammadbobur',
      fullName: 'Muhammad Bobur',
      role: 'super_admin',
      phone: '+998901100808',
      email: 'muhammadbobur1108@gmail.com',
      activeStatus: true,
      allowedTabs: ['home', 'buyurtmalar', 'nakladnoy', 'ombor_tekshiruvi', 'settings'],
    };
    sessionStorage.setItem('chust_erp_session_user', JSON.stringify(owner));
    // Oldingi IndexedDB bazani har testdan oldin tozalash
    indexedDB.deleteDatabase('ombor_audit_erp_db');
  });

  await page.goto('/');
  await page.getByRole('button', { name: 'Ombor tekshiruvi' }).first().click();
  await expect(page.getByText('Склад — Excel ma\'lumot kiritish jadvali')).toBeVisible();

  // Bo'sh holatdan birinchi qatorni qo'shib Excel gridni ochamiz
  await page.getByRole('button', { name: "Birinchi qatorni qo'shish" }).click();
  await expect(page.getByTestId('sklad-excel-grid')).toBeVisible();
}

test.describe('Склад Excel Grid — E2E klaviatura, qo\'yish, tanlash, undo/redo', () => {
  test('Excel 50x10 jadvalni qo\'yish (probel saqlanadi), Ctrl+Z va Ctrl+Y bilan bitta qadamda bekor/qayta tiklash', async ({ page }) => {
    await openSkladGrid(page);

    const grid = page.getByTestId('sklad-excel-grid');
    await page.locator('[data-cell="0,0"]').click();

    // 50x10 TSV ma'lumot tayyorlash (0-qator 3-ustun Заказ bosh/oxiri probelli)
    const lines: string[] = [];
    for (let r = 0; r < 50; r++) {
      const cols: string[] = [];
      for (let c = 0; c < 10; c++) {
        cols.push(r === 0 && c === 3 ? ' MOS-001 ' : `C_${r}_${c}`);
      }
      lines.push(cols.join('\t'));
    }
    const tsv = lines.join('\r\n') + '\r\n';

    await grid.evaluate((el, text) => {
      const dt = new DataTransfer();
      dt.setData('text/plain', text);
      el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
    }, tsv);

    await expect(page.getByTestId('status-row-count')).toContainText('Qator: 50/50');
    await expect(page.locator('[data-cell="0,3"]')).toContainText(' MOS-001 ');

    // Pastga aylantirib 50-qator (index 49) mavjudligini tekshirish
    await grid.evaluate(el => {
      el.scrollTop = el.scrollHeight;
    });
    await expect(page.locator('[data-cell="49,9"]')).toContainText('C_49_9');

    // Ctrl+Z -> butun 50x10 qo'yish 1 qadamda bekor qilinadi
    await grid.focus();
    await page.keyboard.press('Control+z');
    await expect(page.getByTestId('status-row-count')).toContainText('Qator: 1/1');

    // Ctrl+Y -> qayta tiklanadi
    await page.keyboard.press('Control+y');
    await expect(page.getByTestId('status-row-count')).toContainText('Qator: 50/50');
  });

  test('Shift+Strelka tanlash, Delete o\'chirish, Ctrl+Z tiklash va Tab/Enter navigatsiyasi', async ({ page }) => {
    await openSkladGrid(page);

    const grid = page.getByTestId('sklad-excel-grid');
    await page.locator('[data-cell="0,0"]').click();

    // 4x4 blok qo'yish
    const block = [
      'Да\t243\t1-сорт\tORD-1',
      'Да\t244\t2-сорт\tORD-2',
      'Да\t\t3-сорт\tORD-3',
      '\t\t1-сорт\tORD-4',
    ].join('\n');

    await grid.evaluate((el, text) => {
      const dt = new DataTransfer();
      dt.setData('text/plain', text);
      el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
    }, block);

    await expect(page.getByTestId('status-row-count')).toContainText('Qator: 4/4');

    // Tab / Shift+Tab / Enter / Shift+Enter navigatsiyasi
    await page.locator('[data-cell="0,0"]').click();
    await expect(page.getByTestId('status-active-address')).toContainText('A1');
    await page.keyboard.press('Tab');
    await expect(page.getByTestId('status-active-address')).toContainText('B1');
    await page.keyboard.press('Shift+Tab');
    await expect(page.getByTestId('status-active-address')).toContainText('A1');
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('status-active-address')).toContainText('A2');
    await page.keyboard.press('Shift+Enter');
    await expect(page.getByTestId('status-active-address')).toContainText('A1');

    // Shift+Strelka bilan 2x2 diapazon (0,1 -> 1,2) tanlash
    await page.locator('[data-cell="0,1"]').click();
    await page.keyboard.press('Shift+ArrowDown');
    await page.keyboard.press('Shift+ArrowRight');
    await expect(page.getByTestId('status-selected-count')).toContainText('Tanlangan: 4');

    // Delete -> tanlangan 4 ta katakni bitta qadamda tozalash
    await page.keyboard.press('Delete');
    await expect(page.locator('[data-cell="0,1"]')).toHaveText('');
    await expect(page.locator('[data-cell="1,2"]')).toHaveText('');

    // Ctrl+Z -> barcha 4 katak tiklanadi
    await page.keyboard.press('Control+z');
    await expect(page.locator('[data-cell="0,1"]')).toContainText('243');
    await expect(page.locator('[data-cell="1,2"]')).toContainText('2-сорт');
  });

  test('Fokus to\'qnashmasligi (Ctrl+F qidiruv), sana formati (20112026 -> 20.11.2026) va Fill Handle (243, 244 -> 245, 246)', async ({ page }) => {
    await openSkladGrid(page);
    const grid = page.getByTestId('sklad-excel-grid');
    await page.locator('[data-cell="0,0"]').click();

    // 4 qatorlik jadval qo'yamiz (№ тары: 243, 244)
    const rowsBlock = [
      'Да\t243\t1-сорт\tMOS-TEST',
      'Да\t244\t1-сорт\tMOS-KEEP',
      'Да\t\t1-сорт\tMOS-3',
      'Да\t\t1-сорт\tMOS-4',
    ].join('\n');

    await grid.evaluate((el, text) => {
      const dt = new DataTransfer();
      dt.setData('text/plain', text);
      el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
    }, rowsBlock);

    await expect(page.getByTestId('status-row-count')).toContainText('Qator: 4/4');

    // Fill Handle bilan 243, 244 ni pastga 2 ta katakka sudrab 245, 246 qilish
    await page.locator('[data-cell="0,1"]').click();
    await page.keyboard.press('Shift+ArrowDown');
    await expect(page.getByTestId('status-selected-count')).toContainText('Tanlangan: 2');

    const handle = page.getByTestId('fill-handle');
    const handleBox = await handle.boundingBox();
    const targetBox = await page.locator('[data-cell="3,1"]').boundingBox();
    if (!handleBox || !targetBox) throw new Error('Fill handle or target cell missing');

    await page.mouse.move(handleBox.x + handleBox.width / 2, handleBox.y + handleBox.height / 2);
    await page.mouse.down();
    await page.mouse.move(targetBox.x + targetBox.width / 2, targetBox.y + targetBox.height / 2, { steps: 6 });
    await page.mouse.up();

    await expect(page.locator('[data-cell="2,1"]')).toContainText('245');
    await expect(page.locator('[data-cell="3,1"]')).toContainText('246');

    // Ctrl+F qidiruv maydoniga fokus berishi va Ctrl+A faqat qidiruv matnini tanlashi kerak
    await page.locator('[data-cell="0,0"]').click();
    await page.keyboard.press('Control+f');
    const searchInput = page.getByPlaceholder('Qidirish (Ctrl+F): tara, zakaz, model, rang...');
    await expect(searchInput).toBeFocused();
    await searchInput.fill('MOS-TEST');
    await expect(page.getByTestId('status-row-count')).toContainText('Qator: 1/4');
    await page.keyboard.press('Control+a');
    // Search input ichida Ctrl+A jadvaldagi barcha kataklarni tanlab yubormasligi kerak (Tanlangan: 1 qoladi)
    await expect(page.getByTestId('status-selected-count')).toContainText('Tanlangan: 1');
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('status-row-count')).toContainText('Qator: 4/4');

    // O'ngdagi Дата упак. (index 37) katagiga o'tib 20112026 yozish -> 20.11.2026
    await grid.evaluate(el => {
      el.scrollLeft = el.scrollWidth;
    });
    const dateCell = page.locator('[data-cell="0,37"]');
    await dateCell.dblclick();
    const editor = page.getByTestId('grid-cell-editor');
    await editor.fill('20112026');
    await page.keyboard.press('Enter');
    await expect(dateCell).toContainText('20.11.2026');
  });
});
