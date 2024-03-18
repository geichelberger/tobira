import { Page, expect } from "@playwright/test";
import { USERS, UserId } from "./user";

/**
 * Creates the user realm for the given user.
 *
 * - Pre-conditions: User is already logged in, the user has no user realm yet.
 * - Post-conditions: User realm created, is on the page that Tobira forwards to
 *   immediately after creating the realm.
 */
export const createUserRealm = async (page: Page, userid: UserId) => {
    await page.getByRole("button", { name: USERS[userid] }).click();
    await page.getByRole("link", { name: "My page" }).click();
    await expect(page).toHaveURL(`/@${userid}`);
    await page.getByRole("button", { name: "Create your own page" }).click();
};

/**
 * Sets up or navigates to either a user realm or a non-user realm.
 *
 * - Pre-conditions: User is not logged in. If `realmType` is `user`,
 *   the user must not have a user realm yet.
 * - Post-conditions: If `realmType` is `user`: User realm created, user
 *   is on the page that Tobira forwards to immediately after creating the realm.
 *   Otherwise, if `realmType` is `regular`, nothing was created but the user
 *   is on a non-root realm page ("/support" or "/empty").
 */
export const realmSetup = async (
    page: Page,
    userid: UserId,
    realmType: Realm,
    parentPageName: string,
    empty?: boolean,
) => {
    await test.step("Setup", async () => {
        await page.goto("/");
        await login(page, userid);

        // Go to a non-root realm
        if (realmType === "Regular") {
            if (empty) {
                // This is an unfortunate workaround.
                // The `nth()` locator used in block tests sometimes resolves to the wrong
                // element if there is already a block present.
                // I believe this is a bug in playwright. To prevent that from happening,
                // the block tests should always be starting with an empty realm.
                await page.locator("nav").getByRole("link", { name: "Empty" }).click();
                await expect(page).toHaveURL("/empty");
            } else {
                await page.locator("nav").getByRole("link", { name: parentPageName }).click();
                await expect(page).toHaveURL("/support");
            }
        }

        // Create user realm
        if (realmType === "User") {
            await test.step("Create new user realm", async () => {
                await createUserRealm(page, userid);
            });
            await page.locator("nav").getByRole("link", { name: parentPageName }).click();
            await expect(page).toHaveURL(`/@${userid}`);
        }
    });
};


/**
 * Creates a sub-realm on the page you are currently on.
 *
 * - Pre-conditions: logged in & on a realm page with privileges to create a sub-realm.
 * - Post-conditions: Realm created, on the page "Edit realm contents" page.
 */
export const addSubPage = async (page: Page, name: string, pathSegment?: string) => {
    await page.getByRole("link", { name: "Add subpage" }).first().click();
    await page.getByPlaceholder("Page name").fill(name);
    await page.keyboard.press("Tab");
    await page.keyboard.press("Tab");
    await expect(page.getByLabel("Path segment")).toBeFocused();
    await page.keyboard.type(pathSegment ?? name.trim().toLowerCase().replace(/\s+/g, "-"));
    await page.getByRole("button", { name: "Create page" }).click();
    await expect(page.getByRole("heading", { name: `Edit page “${name}”`, level: 1 }))
        .toBeVisible();
};

type Block =
    | {
        type: "title";
        text: string;
    }
    | {
        type: "text";
        text: string;
    }
    | {
        type: "video";
        query: string;
        showTitle?: boolean;
        showLink?: boolean;
    };

/**
 * Adds the specified block. For series and video blocks, picks the first result
 * returned for `query`. `query` must be a substring of said result's title.
 *
 * - Pre-conditions: logged in, already on "edit realm contents" page.
 * - Post-conditions: added block, still on "edit realm contents" page.
 */
export const addBlock = async (page: Page, pos: number, block: Block) => {
    await expect(page.getByRole("heading", { name: "Edit page" })).toBeVisible();

    const addButtons = page.getByRole("button", { name: "Insert a new block here" });
    const saveButton = page.getByRole("button", { name: "Save" });
    const numSlots = await addButtons.count();

    await addButtons.nth(pos).click();
    await page.getByRole("button", { name: block.type }).click();

    switch (block.type) {
        case "title": {
            await page.getByPlaceholder("Title").fill(block.text);
            await saveButton.click();
            break;
        }
        case "text": {
            await page.getByPlaceholder("You can add your text content here").fill(block.text);
            await saveButton.click();
            break;
        }
        case "video": {
            const input = page.getByRole("combobox");
            await input.pressSequentially(block.query);
            await page.getByRole("img", { name: block.query }).click();

            const titleCheckbox = page.getByLabel("Show title");
            await expect(titleCheckbox).toBeChecked();
            await titleCheckbox.setChecked(block.showTitle ?? true);
            const linkCheckbox = page.getByLabel("Show link to video page");
            await expect(linkCheckbox).toBeChecked();
            await linkCheckbox.setChecked(block.showTitle ?? true);

            await saveButton.click();
            break;
        }
    }

    await expect(addButtons).toHaveCount(numSlots + 1);
    await expect(saveButton).toBeHidden();
};
