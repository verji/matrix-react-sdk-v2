/*
Copyright 2022 - 2023 The Matrix.org Foundation C.I.C.

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
*/

/// <reference types="cypress" />

import { test, expect } from "../../element-web-test";
import type { Page } from "@playwright/test";
import type { Bot } from "../../pages/bot";
import type { Client } from "../../pages/client";

test.describe("Poll history", () => {
    type CreatePollOptions = {
        title: string;
        options: {
            "id": string;
            "org.matrix.msc1767.text": string;
        }[];
    };
    const createPoll = async (createOptions: CreatePollOptions, roomId: string, client: Client) => {
        return await client.evaluate(
            (client, { createOptions, roomId }) => {
                return client.sendEvent(roomId, "org.matrix.msc3381.poll.start", {
                    "org.matrix.msc3381.poll.start": {
                        question: {
                            "org.matrix.msc1767.text": createOptions.title,
                            "body": createOptions.title,
                            "msgtype": "m.text",
                        },
                        kind: "org.matrix.msc3381.poll.disclosed",
                        max_selections: 1,
                        answers: createOptions.options,
                    },
                    "org.matrix.msc1767.text": "poll fallback text",
                });
            },
            { createOptions, roomId },
        );
    };

    const botVoteForOption = async (bot: Bot, roomId: string, pollId: string, optionId: string): Promise<void> => {
        // We can't use the js-sdk types for this stuff directly, so manually construct the event.
        await bot.evaluate(
            (bot, { roomId, pollId, optionId }) => {
                return bot.sendEvent(roomId, "org.matrix.msc3381.poll.response", {
                    "m.relates_to": {
                        rel_type: "m.reference",
                        event_id: pollId,
                    },
                    "org.matrix.msc3381.poll.response": {
                        answers: [optionId],
                    },
                });
            },
            { roomId, pollId, optionId },
        );
    };

    const endPoll = async (bot: Bot, roomId: string, pollId: string): Promise<void> => {
        // We can't use the js-sdk types for this stuff directly, so manually construct the event.
        await bot.evaluate(
            (bot, { roomId, pollId }) => {
                return bot.sendEvent(roomId, "org.matrix.msc3381.poll.end", {
                    "m.relates_to": {
                        rel_type: "m.reference",
                        event_id: pollId,
                    },
                    "org.matrix.msc1767.text": "The poll has ended",
                });
            },
            { roomId, pollId },
        );
    };

    async function openPollHistory(page: Page): Promise<void> {
        await page.getByRole("button", { name: "Room info" }).click();
        await page.locator(".mx_RoomSummaryCard").getByRole("menuitem", { name: "Poll history" }).click();
    }

    test.use({
        displayName: "Tom",
        botCreateOpts: { displayName: "BotBob" },
    });

    test.beforeEach(async ({ page, user }) => {
        await page.evaluate(() => {
            // Collapse left panel for these tests
            window.localStorage.setItem("mx_lhs_size", "0");
        });
    });

    test("Should display active and past polls", async ({ page, app, bot }) => {
        const pollParams1 = {
            title: "Does the polls feature work?",
            options: ["Yes", "No", "Maybe"].map((option) => ({
                "id": option,
                "org.matrix.msc1767.text": option,
            })),
        };

        const pollParams2 = {
            title: "Which way",
            options: ["Left", "Right"].map((option) => ({
                "id": option,
                "org.matrix.msc1767.text": option,
            })),
        };

        const roomId = await app.client.createRoom({});

        const botUserId = await bot.evaluate((bot) => bot.getUserId());
        await app.client.inviteUser(roomId, botUserId);
        await page.goto("/#/room/" + roomId);
        // wait until Bob joined
        await expect(page.getByText("BotBob joined the room")).toBeAttached();

        // active poll
        const { event_id: pollId1 } = await createPoll(pollParams1, roomId, bot);
        await botVoteForOption(bot, roomId, pollId1, pollParams1.options[1].id);

        // ended poll
        const { event_id: pollId2 } = await createPoll(pollParams2, roomId, bot);
        await botVoteForOption(bot, roomId, pollId2, pollParams1.options[1].id);
        await endPoll(bot, roomId, pollId2);

        await openPollHistory(page);

        // these polls are also in the timeline
        // focus on the poll history dialog
        const dialog = page.locator(".mx_Dialog");

        // active poll is in active polls list
        // open poll detail
        await dialog.getByText(pollParams1.title).click();
        await dialog.getByText("Yes").click();
        // vote in the poll
        await expect(dialog.getByTestId("totalVotes").getByText("Based on 2 votes")).toBeAttached();
        // navigate back to list
        await dialog.locator(".mx_PollHistory_header").getByRole("button", { name: "Active polls" }).click();

        // go to past polls list
        await dialog.getByText("Past polls").click();

        await expect(dialog.getByText(pollParams2.title)).toBeAttached();

        // end poll1 while dialog is open
        await endPoll(bot, roomId, pollId1);

        await expect(dialog.getByText(pollParams2.title)).toBeAttached();
        await expect(dialog.getByText(pollParams1.title)).toBeAttached();
        dialog.getByText("Active polls").click();

        // no more active polls
        await expect(page.getByText("There are no active polls in this room")).toBeAttached();
    });
});
