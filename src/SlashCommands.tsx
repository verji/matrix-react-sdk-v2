/*
Copyright 2015, 2016 OpenMarket Ltd
Copyright 2018 New Vector Ltd
Copyright 2019 Michael Telatynski <7t3chguy@gmail.com>
Copyright 2020 The Matrix.org Foundation C.I.C.

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

import * as React from "react";
import { User, IContent, Direction, ContentHelpers } from "matrix-js-sdk/src/matrix";
import { logger } from "matrix-js-sdk/src/logger";
import { MRoomTopicEventContent } from "matrix-js-sdk/src/@types/topic";

import dis from "./dispatcher/dispatcher";
import { _t, _td, UserFriendlyError } from "./languageHandler";
import Modal from "./Modal";
import MultiInviter from "./utils/MultiInviter";
import { Linkify, topicToHtml } from "./HtmlUtils";
import QuestionDialog from "./components/views/dialogs/QuestionDialog";
import WidgetUtils from "./utils/WidgetUtils";
import { textToHtmlRainbow } from "./utils/colour";
import { AddressType, getAddressType } from "./UserAddress";
import { abbreviateUrl } from "./utils/UrlUtils";
import { getDefaultIdentityServerUrl, setToDefaultIdentityServer } from "./utils/IdentityServerUtils";
import { WidgetType } from "./widgets/WidgetType";
import { Jitsi } from "./widgets/Jitsi";
import BugReportDialog from "./components/views/dialogs/BugReportDialog";
import { ensureDMExists } from "./createRoom";
import { ViewUserPayload } from "./dispatcher/payloads/ViewUserPayload";
import { Action } from "./dispatcher/actions";
import SdkConfig from "./SdkConfig";
import SettingsStore from "./settings/SettingsStore";
import { UIComponent, UIFeature } from "./settings/UIFeature";
import { CHAT_EFFECTS } from "./effects";
import LegacyCallHandler from "./LegacyCallHandler";
import { guessAndSetDMRoom } from "./Rooms";
import { upgradeRoom } from "./utils/RoomUpgrade";
import DevtoolsDialog from "./components/views/dialogs/DevtoolsDialog";
import RoomUpgradeWarningDialog from "./components/views/dialogs/RoomUpgradeWarningDialog";
import InfoDialog from "./components/views/dialogs/InfoDialog";
import SlashCommandHelpDialog from "./components/views/dialogs/SlashCommandHelpDialog";
import { shouldShowComponent } from "./customisations/helpers/UIComponents";
import { TimelineRenderingType } from "./contexts/RoomContext";
import { ViewRoomPayload } from "./dispatcher/payloads/ViewRoomPayload";
import VoipUserMapper from "./VoipUserMapper";
import { htmlSerializeFromMdIfNeeded } from "./editor/serialize";
import { leaveRoomBehaviour } from "./utils/leave-behaviour";
import { MatrixClientPeg } from "./MatrixClientPeg";
import { getDeviceCryptoInfo } from "./utils/crypto/deviceInfo";
import { isCurrentLocalRoom, reject, singleMxcUpload, success, successSync } from "./slash-commands/utils";
import { deop, op } from "./slash-commands/op";
import { CommandCategories } from "./slash-commands/interface";
import { Command } from "./slash-commands/command";
import { goto, join } from "./slash-commands/join";

export { CommandCategories, Command };

export const Commands = [
    new Command({
        command: "spoiler",
        args: "<message>",
        description: _td("Sends the given message as a spoiler"),
        runFn: function (cli, roomId, threadId, message = "") {
            return successSync(ContentHelpers.makeHtmlMessage(message, `<span data-mx-spoiler>${message}</span>`));
        },
        category: CommandCategories.messages,
    }),
    new Command({
        command: "shrug",
        args: "<message>",
        description: _td("Prepends ¯\\_(ツ)_/¯ to a plain-text message"),
        runFn: function (cli, roomId, threadId, args) {
            let message = "¯\\_(ツ)_/¯";
            if (args) {
                message = message + " " + args;
            }
            return successSync(ContentHelpers.makeTextMessage(message));
        },
        category: CommandCategories.messages,
    }),
    new Command({
        command: "tableflip",
        args: "<message>",
        description: _td("Prepends (╯°□°）╯︵ ┻━┻ to a plain-text message"),
        runFn: function (cli, roomId, threadId, args) {
            let message = "(╯°□°）╯︵ ┻━┻";
            if (args) {
                message = message + " " + args;
            }
            return successSync(ContentHelpers.makeTextMessage(message));
        },
        category: CommandCategories.messages,
    }),
    new Command({
        command: "unflip",
        args: "<message>",
        description: _td("Prepends ┬──┬ ノ( ゜-゜ノ) to a plain-text message"),
        runFn: function (cli, roomId, threadId, args) {
            let message = "┬──┬ ノ( ゜-゜ノ)";
            if (args) {
                message = message + " " + args;
            }
            return successSync(ContentHelpers.makeTextMessage(message));
        },
        category: CommandCategories.messages,
    }),
    new Command({
        command: "lenny",
        args: "<message>",
        description: _td("Prepends ( ͡° ͜ʖ ͡°) to a plain-text message"),
        runFn: function (cli, roomId, threadId, args) {
            let message = "( ͡° ͜ʖ ͡°)";
            if (args) {
                message = message + " " + args;
            }
            return successSync(ContentHelpers.makeTextMessage(message));
        },
        category: CommandCategories.messages,
    }),
    new Command({
        command: "plain",
        args: "<message>",
        description: _td("Sends a message as plain text, without interpreting it as markdown"),
        runFn: function (cli, roomId, threadId, messages = "") {
            return successSync(ContentHelpers.makeTextMessage(messages));
        },
        category: CommandCategories.messages,
    }),
    new Command({
        command: "html",
        args: "<message>",
        description: _td("Sends a message as html, without interpreting it as markdown"),
        runFn: function (cli, roomId, threadId, messages = "") {
            return successSync(ContentHelpers.makeHtmlMessage(messages, messages));
        },
        category: CommandCategories.messages,
    }),
    new Command({
        command: "upgraderoom",
        args: "<new_version>",
        description: _td("Upgrades a room to a new version"),
        isEnabled: (cli) => !isCurrentLocalRoom(cli),
        runFn: function (cli, roomId, threadId, args) {
            if (args) {
                const room = cli.getRoom(roomId);
                if (!room?.currentState.mayClientSendStateEvent("m.room.tombstone", cli)) {
                    return reject(
                        new UserFriendlyError("You do not have the required permissions to use this command."),
                    );
                }

                const { finished } = Modal.createDialog(
                    RoomUpgradeWarningDialog,
                    { roomId: roomId, targetVersion: args },
                    /*className=*/ undefined,
                    /*isPriority=*/ false,
                    /*isStatic=*/ true,
                );

                return success(
                    finished.then(async ([resp]): Promise<void> => {
                        if (!resp?.continue) return;
                        await upgradeRoom(room, args, resp.invite);
                    }),
                );
            }
            return reject(this.getUsage());
        },
        category: CommandCategories.admin,
        renderingTypes: [TimelineRenderingType.Room],
    }),
    new Command({
        command: "jumptodate",
        args: "<YYYY-MM-DD>",
        description: _td("Jump to the given date in the timeline"),
        isEnabled: () => SettingsStore.getValue("feature_jump_to_date"),
        runFn: function (cli, roomId, threadId, args) {
            if (args) {
                return success(
                    (async (): Promise<void> => {
                        const unixTimestamp = Date.parse(args);
                        if (!unixTimestamp) {
                            throw new UserFriendlyError(
                                "We were unable to understand the given date (%(inputDate)s). " +
                                    "Try using the format YYYY-MM-DD.",
                                { inputDate: args, cause: undefined },
                            );
                        }

                        const { event_id: eventId, origin_server_ts: originServerTs } = await cli.timestampToEvent(
                            roomId,
                            unixTimestamp,
                            Direction.Forward,
                        );
                        logger.log(
                            `/timestamp_to_event: found ${eventId} (${originServerTs}) for timestamp=${unixTimestamp}`,
                        );
                        dis.dispatch<ViewRoomPayload>({
                            action: Action.ViewRoom,
                            event_id: eventId,
                            highlighted: true,
                            room_id: roomId,
                            metricsTrigger: "SlashCommand",
                            metricsViaKeyboard: true,
                        });
                    })(),
                );
            }

            return reject(this.getUsage());
        },
        category: CommandCategories.actions,
    }),
    new Command({
        command: "nick",
        args: "<display_name>",
        description: _td("Changes your display nickname"),
        runFn: function (cli, roomId, threadId, args) {
            if (args) {
                return success(cli.setDisplayName(args));
            }
            return reject(this.getUsage());
        },
        category: CommandCategories.actions,
        renderingTypes: [TimelineRenderingType.Room],
    }),
    new Command({
        command: "myroomnick",
        aliases: ["roomnick"],
        args: "<display_name>",
        description: _td("Changes your display nickname in the current room only"),
        isEnabled: (cli) => !isCurrentLocalRoom(cli),
        runFn: function (cli, roomId, threadId, args) {
            if (args) {
                const ev = cli.getRoom(roomId)?.currentState.getStateEvents("m.room.member", cli.getSafeUserId());
                const content = {
                    ...(ev ? ev.getContent() : { membership: "join" }),
                    displayname: args,
                };
                return success(cli.sendStateEvent(roomId, "m.room.member", content, cli.getSafeUserId()));
            }
            return reject(this.getUsage());
        },
        category: CommandCategories.actions,
        renderingTypes: [TimelineRenderingType.Room],
    }),
    new Command({
        command: "roomavatar",
        args: "[<mxc_url>]",
        description: _td("Changes the avatar of the current room"),
        isEnabled: (cli) => !isCurrentLocalRoom(cli),
        runFn: function (cli, roomId, threadId, args) {
            let promise = Promise.resolve(args ?? null);
            if (!args) {
                promise = singleMxcUpload(cli);
            }

            return success(
                promise.then((url) => {
                    if (!url) return;
                    return cli.sendStateEvent(roomId, "m.room.avatar", { url }, "");
                }),
            );
        },
        category: CommandCategories.actions,
        renderingTypes: [TimelineRenderingType.Room],
    }),
    new Command({
        command: "myroomavatar",
        args: "[<mxc_url>]",
        description: _td("Changes your profile picture in this current room only"),
        isEnabled: (cli) => !isCurrentLocalRoom(cli),
        runFn: function (cli, roomId, threadId, args) {
            const room = cli.getRoom(roomId);
            const userId = cli.getSafeUserId();

            let promise = Promise.resolve(args ?? null);
            if (!args) {
                promise = singleMxcUpload(cli);
            }

            return success(
                promise.then((url) => {
                    if (!url) return;
                    const ev = room?.currentState.getStateEvents("m.room.member", userId);
                    const content = {
                        ...(ev ? ev.getContent() : { membership: "join" }),
                        avatar_url: url,
                    };
                    return cli.sendStateEvent(roomId, "m.room.member", content, userId);
                }),
            );
        },
        category: CommandCategories.actions,
        renderingTypes: [TimelineRenderingType.Room],
    }),
    new Command({
        command: "myavatar",
        args: "[<mxc_url>]",
        description: _td("Changes your profile picture in all rooms"),
        runFn: function (cli, roomId, threadId, args) {
            let promise = Promise.resolve(args ?? null);
            if (!args) {
                promise = singleMxcUpload(cli);
            }

            return success(
                promise.then((url) => {
                    if (!url) return;
                    return cli.setAvatarUrl(url);
                }),
            );
        },
        category: CommandCategories.actions,
        renderingTypes: [TimelineRenderingType.Room],
    }),
    new Command({
        command: "topic",
        args: "[<topic>]",
        description: _td("Gets or sets the room topic"),
        isEnabled: (cli) => !isCurrentLocalRoom(cli),
        runFn: function (cli, roomId, threadId, args) {
            if (args) {
                const html = htmlSerializeFromMdIfNeeded(args, { forceHTML: false });
                return success(cli.setRoomTopic(roomId, args, html));
            }
            const room = cli.getRoom(roomId);
            if (!room) {
                return reject(
                    new UserFriendlyError("Failed to get room topic: Unable to find room (%(roomId)s", {
                        roomId,
                        cause: undefined,
                    }),
                );
            }

            const content = room.currentState.getStateEvents("m.room.topic", "")?.getContent<MRoomTopicEventContent>();
            const topic = !!content
                ? ContentHelpers.parseTopicContent(content)
                : { text: _t("This room has no topic.") };

            const body = topicToHtml(topic.text, topic.html, undefined, true);

            Modal.createDialog(InfoDialog, {
                title: room.name,
                description: <Linkify>{body}</Linkify>,
                hasCloseButton: true,
                className: "markdown-body",
            });
            return success();
        },
        category: CommandCategories.admin,
        renderingTypes: [TimelineRenderingType.Room],
    }),
    new Command({
        command: "roomname",
        args: "<name>",
        description: _td("Sets the room name"),
        isEnabled: (cli) => !isCurrentLocalRoom(cli),
        runFn: function (cli, roomId, threadId, args) {
            if (args) {
                return success(cli.setRoomName(roomId, args));
            }
            return reject(this.getUsage());
        },
        category: CommandCategories.admin,
        renderingTypes: [TimelineRenderingType.Room],
    }),
    new Command({
        command: "invite",
        args: "<user-id> [<reason>]",
        description: _td("Invites user with given id to current room"),
        analyticsName: "Invite",
        isEnabled: (cli) => !isCurrentLocalRoom(cli) && shouldShowComponent(UIComponent.InviteUsers),
        runFn: function (cli, roomId, threadId, args) {
            if (args) {
                const [address, reason] = args.split(/\s+(.+)/);
                if (address) {
                    // We use a MultiInviter to re-use the invite logic, even though
                    // we're only inviting one user.
                    // If we need an identity server but don't have one, things
                    // get a bit more complex here, but we try to show something
                    // meaningful.
                    let prom = Promise.resolve();
                    if (getAddressType(address) === AddressType.Email && !cli.getIdentityServerUrl()) {
                        const defaultIdentityServerUrl = getDefaultIdentityServerUrl();
                        if (defaultIdentityServerUrl) {
                            const { finished } = Modal.createDialog(QuestionDialog, {
                                title: _t("Use an identity server"),
                                description: (
                                    <p>
                                        {_t(
                                            "Use an identity server to invite by email. " +
                                                "Click continue to use the default identity server " +
                                                "(%(defaultIdentityServerName)s) or manage in Settings.",
                                            {
                                                defaultIdentityServerName: abbreviateUrl(defaultIdentityServerUrl),
                                            },
                                        )}
                                    </p>
                                ),
                                button: _t("action|continue"),
                            });

                            prom = finished.then(([useDefault]) => {
                                if (useDefault) {
                                    setToDefaultIdentityServer(cli);
                                    return;
                                }
                                throw new UserFriendlyError(
                                    "Use an identity server to invite by email. Manage in Settings.",
                                );
                            });
                        } else {
                            return reject(
                                new UserFriendlyError("Use an identity server to invite by email. Manage in Settings."),
                            );
                        }
                    }
                    const inviter = new MultiInviter(cli, roomId);
                    return success(
                        prom
                            .then(() => {
                                return inviter.invite([address], reason, true);
                            })
                            .then(() => {
                                if (inviter.getCompletionState(address) !== "invited") {
                                    const errorStringFromInviterUtility = inviter.getErrorText(address);
                                    if (errorStringFromInviterUtility) {
                                        throw new Error(errorStringFromInviterUtility);
                                    } else {
                                        throw new UserFriendlyError(
                                            "User (%(user)s) did not end up as invited to %(roomId)s but no error was given from the inviter utility",
                                            { user: address, roomId, cause: undefined },
                                        );
                                    }
                                }
                            }),
                    );
                }
            }
            return reject(this.getUsage());
        },
        category: CommandCategories.actions,
        renderingTypes: [TimelineRenderingType.Room],
    }),
    goto,
    join,
    new Command({
        command: "part",
        args: "[<room-address>]",
        description: _td("action|leave_room"),
        analyticsName: "Part",
        isEnabled: (cli) => !isCurrentLocalRoom(cli),
        runFn: function (cli, roomId, threadId, args) {
            let targetRoomId: string | undefined;
            if (args) {
                const matches = args.match(/^(\S+)$/);
                if (matches) {
                    let roomAlias = matches[1];
                    if (roomAlias[0] !== "#") return reject(this.getUsage());

                    if (!roomAlias.includes(":")) {
                        roomAlias += ":" + cli.getDomain();
                    }

                    // Try to find a room with this alias
                    const rooms = cli.getRooms();
                    targetRoomId = rooms.find((room) => {
                        return room.getCanonicalAlias() === roomAlias || room.getAltAliases().includes(roomAlias);
                    })?.roomId;
                    if (!targetRoomId) {
                        return reject(
                            new UserFriendlyError("Unrecognised room address: %(roomAlias)s", {
                                roomAlias,
                                cause: undefined,
                            }),
                        );
                    }
                }
            }

            if (!targetRoomId) targetRoomId = roomId;
            return success(leaveRoomBehaviour(cli, targetRoomId));
        },
        category: CommandCategories.actions,
        renderingTypes: [TimelineRenderingType.Room],
    }),
    new Command({
        command: "remove",
        aliases: ["kick"],
        args: "<user-id> [reason]",
        description: _td("Removes user with given id from this room"),
        isEnabled: (cli) => !isCurrentLocalRoom(cli),
        runFn: function (cli, roomId, threadId, args) {
            if (args) {
                const matches = args.match(/^(\S+?)( +(.*))?$/);
                if (matches) {
                    return success(cli.kick(roomId, matches[1], matches[3]));
                }
            }
            return reject(this.getUsage());
        },
        category: CommandCategories.admin,
        renderingTypes: [TimelineRenderingType.Room],
    }),
    new Command({
        command: "ban",
        args: "<user-id> [reason]",
        description: _td("Bans user with given id"),
        isEnabled: (cli) => !isCurrentLocalRoom(cli),
        runFn: function (cli, roomId, threadId, args) {
            if (args) {
                const matches = args.match(/^(\S+?)( +(.*))?$/);
                if (matches) {
                    return success(cli.ban(roomId, matches[1], matches[3]));
                }
            }
            return reject(this.getUsage());
        },
        category: CommandCategories.admin,
        renderingTypes: [TimelineRenderingType.Room],
    }),
    new Command({
        command: "unban",
        args: "<user-id>",
        description: _td("Unbans user with given ID"),
        isEnabled: (cli) => !isCurrentLocalRoom(cli),
        runFn: function (cli, roomId, threadId, args) {
            if (args) {
                const matches = args.match(/^(\S+)$/);
                if (matches) {
                    // Reset the user membership to "leave" to unban him
                    return success(cli.unban(roomId, matches[1]));
                }
            }
            return reject(this.getUsage());
        },
        category: CommandCategories.admin,
        renderingTypes: [TimelineRenderingType.Room],
    }),
    new Command({
        command: "ignore",
        args: "<user-id>",
        description: _td("Ignores a user, hiding their messages from you"),
        runFn: function (cli, roomId, threadId, args) {
            if (args) {
                const matches = args.match(/^(@[^:]+:\S+)$/);
                if (matches) {
                    const userId = matches[1];
                    const ignoredUsers = cli.getIgnoredUsers();
                    ignoredUsers.push(userId); // de-duped internally in the js-sdk
                    return success(
                        cli.setIgnoredUsers(ignoredUsers).then(() => {
                            Modal.createDialog(InfoDialog, {
                                title: _t("Ignored user"),
                                description: (
                                    <div>
                                        <p>{_t("You are now ignoring %(userId)s", { userId })}</p>
                                    </div>
                                ),
                            });
                        }),
                    );
                }
            }
            return reject(this.getUsage());
        },
        category: CommandCategories.actions,
    }),
    new Command({
        command: "unignore",
        args: "<user-id>",
        description: _td("Stops ignoring a user, showing their messages going forward"),
        runFn: function (cli, roomId, threadId, args) {
            if (args) {
                const matches = args.match(/(^@[^:]+:\S+$)/);
                if (matches) {
                    const userId = matches[1];
                    const ignoredUsers = cli.getIgnoredUsers();
                    const index = ignoredUsers.indexOf(userId);
                    if (index !== -1) ignoredUsers.splice(index, 1);
                    return success(
                        cli.setIgnoredUsers(ignoredUsers).then(() => {
                            Modal.createDialog(InfoDialog, {
                                title: _t("Unignored user"),
                                description: (
                                    <div>
                                        <p>{_t("You are no longer ignoring %(userId)s", { userId })}</p>
                                    </div>
                                ),
                            });
                        }),
                    );
                }
            }
            return reject(this.getUsage());
        },
        category: CommandCategories.actions,
    }),
    op,
    deop,
    new Command({
        command: "devtools",
        description: _td("Opens the Developer Tools dialog"),
        runFn: function (cli, roomId, threadRootId) {
            Modal.createDialog(DevtoolsDialog, { roomId, threadRootId }, "mx_DevtoolsDialog_wrapper");
            return success();
        },
        category: CommandCategories.advanced,
    }),
    new Command({
        command: "addwidget",
        args: "<url | embed code | Jitsi url>",
        description: _td("Adds a custom widget by URL to the room"),
        isEnabled: (cli) =>
            SettingsStore.getValue(UIFeature.Widgets) &&
            shouldShowComponent(UIComponent.AddIntegrations) &&
            !isCurrentLocalRoom(cli),
        runFn: function (cli, roomId, threadId, widgetUrl) {
            if (!widgetUrl) {
                return reject(new UserFriendlyError("Please supply a widget URL or embed code"));
            }

            // Try and parse out a widget URL from iframes
            if (widgetUrl.toLowerCase().startsWith("<iframe ")) {
                const embed = new DOMParser().parseFromString(widgetUrl, "text/html").body;
                if (embed?.childNodes?.length === 1) {
                    const iframe = embed.firstElementChild;
                    if (iframe?.tagName.toLowerCase() === "iframe") {
                        logger.log("Pulling URL out of iframe (embed code)");
                        if (!iframe.hasAttribute("src")) {
                            return reject(new UserFriendlyError("iframe has no src attribute"));
                        }
                        widgetUrl = iframe.getAttribute("src")!;
                    }
                }
            }

            if (!widgetUrl.startsWith("https://") && !widgetUrl.startsWith("http://")) {
                return reject(new UserFriendlyError("Please supply a https:// or http:// widget URL"));
            }
            if (WidgetUtils.canUserModifyWidgets(cli, roomId)) {
                const userId = cli.getUserId();
                const nowMs = new Date().getTime();
                const widgetId = encodeURIComponent(`${roomId}_${userId}_${nowMs}`);
                let type = WidgetType.CUSTOM;
                let name = "Custom";
                let data = {};

                // Make the widget a Jitsi widget if it looks like a Jitsi widget
                const jitsiData = Jitsi.getInstance().parsePreferredConferenceUrl(widgetUrl);
                if (jitsiData) {
                    logger.log("Making /addwidget widget a Jitsi conference");
                    type = WidgetType.JITSI;
                    name = "Jitsi";
                    data = jitsiData;
                    widgetUrl = WidgetUtils.getLocalJitsiWrapperUrl();
                }

                return success(WidgetUtils.setRoomWidget(cli, roomId, widgetId, type, widgetUrl, name, data));
            } else {
                return reject(new UserFriendlyError("You cannot modify widgets in this room."));
            }
        },
        category: CommandCategories.admin,
        renderingTypes: [TimelineRenderingType.Room],
    }),
    new Command({
        command: "verify",
        args: "<user-id> <device-id> <device-signing-key>",
        description: _td("Verifies a user, session, and pubkey tuple"),
        runFn: function (cli, roomId, threadId, args) {
            if (args) {
                const matches = args.match(/^(\S+) +(\S+) +(\S+)$/);
                if (matches) {
                    const userId = matches[1];
                    const deviceId = matches[2];
                    const fingerprint = matches[3];

                    return success(
                        (async (): Promise<void> => {
                            const device = await getDeviceCryptoInfo(cli, userId, deviceId);
                            if (!device) {
                                throw new UserFriendlyError(
                                    "Unknown (user, session) pair: (%(userId)s, %(deviceId)s)",
                                    {
                                        userId,
                                        deviceId,
                                        cause: undefined,
                                    },
                                );
                            }
                            const deviceTrust = await cli.getCrypto()?.getDeviceVerificationStatus(userId, deviceId);

                            if (deviceTrust?.isVerified()) {
                                if (device.getFingerprint() === fingerprint) {
                                    throw new UserFriendlyError("Session already verified!");
                                } else {
                                    throw new UserFriendlyError(
                                        "WARNING: session already verified, but keys do NOT MATCH!",
                                    );
                                }
                            }

                            if (device.getFingerprint() !== fingerprint) {
                                const fprint = device.getFingerprint();
                                throw new UserFriendlyError(
                                    "WARNING: KEY VERIFICATION FAILED! The signing key for %(userId)s and session" +
                                        ' %(deviceId)s is "%(fprint)s" which does not match the provided key ' +
                                        '"%(fingerprint)s". This could mean your communications are being intercepted!',
                                    {
                                        fprint,
                                        userId,
                                        deviceId,
                                        fingerprint,
                                        cause: undefined,
                                    },
                                );
                            }

                            await cli.setDeviceVerified(userId, deviceId, true);

                            // Tell the user we verified everything
                            Modal.createDialog(InfoDialog, {
                                title: _t("Verified key"),
                                description: (
                                    <div>
                                        <p>
                                            {_t(
                                                "The signing key you provided matches the signing key you received " +
                                                    "from %(userId)s's session %(deviceId)s. Session marked as verified.",
                                                { userId, deviceId },
                                            )}
                                        </p>
                                    </div>
                                ),
                            });
                        })(),
                    );
                }
            }
            return reject(this.getUsage());
        },
        category: CommandCategories.advanced,
        renderingTypes: [TimelineRenderingType.Room],
    }),
    new Command({
        command: "discardsession",
        description: _td("Forces the current outbound group session in an encrypted room to be discarded"),
        isEnabled: (cli) => !isCurrentLocalRoom(cli),
        runFn: function (cli, roomId) {
            try {
                cli.forceDiscardSession(roomId);
            } catch (e) {
                return reject(e instanceof Error ? e.message : e);
            }
            return success();
        },
        category: CommandCategories.advanced,
        renderingTypes: [TimelineRenderingType.Room],
    }),
    new Command({
        command: "remakeolm",
        description: _td("Developer command: Discards the current outbound group session and sets up new Olm sessions"),
        isEnabled: (cli) => {
            return SettingsStore.getValue("developerMode") && !isCurrentLocalRoom(cli);
        },
        runFn: (cli, roomId) => {
            try {
                const room = cli.getRoom(roomId);

                cli.forceDiscardSession(roomId);

                return success(
                    room?.getEncryptionTargetMembers().then((members) => {
                        // noinspection JSIgnoredPromiseFromCall
                        cli.crypto?.ensureOlmSessionsForUsers(
                            members.map((m) => m.userId),
                            true,
                        );
                    }),
                );
            } catch (e) {
                return reject(e instanceof Error ? e.message : e);
            }
        },
        category: CommandCategories.advanced,
        renderingTypes: [TimelineRenderingType.Room],
    }),
    new Command({
        command: "rainbow",
        description: _td("Sends the given message coloured as a rainbow"),
        args: "<message>",
        runFn: function (cli, roomId, threadId, args) {
            if (!args) return reject(this.getUsage());
            return successSync(ContentHelpers.makeHtmlMessage(args, textToHtmlRainbow(args)));
        },
        category: CommandCategories.messages,
    }),
    new Command({
        command: "rainbowme",
        description: _td("Sends the given emote coloured as a rainbow"),
        args: "<message>",
        runFn: function (cli, roomId, threadId, args) {
            if (!args) return reject(this.getUsage());
            return successSync(ContentHelpers.makeHtmlEmote(args, textToHtmlRainbow(args)));
        },
        category: CommandCategories.messages,
    }),
    new Command({
        command: "help",
        description: _td("Displays list of commands with usages and descriptions"),
        runFn: function () {
            Modal.createDialog(SlashCommandHelpDialog);
            return success();
        },
        category: CommandCategories.advanced,
    }),
    new Command({
        command: "whois",
        description: _td("Displays information about a user"),
        args: "<user-id>",
        isEnabled: (cli) => !isCurrentLocalRoom(cli),
        runFn: function (cli, roomId, threadId, userId) {
            if (!userId || !userId.startsWith("@") || !userId.includes(":")) {
                return reject(this.getUsage());
            }

            const member = cli.getRoom(roomId)?.getMember(userId);
            dis.dispatch<ViewUserPayload>({
                action: Action.ViewUser,
                // XXX: We should be using a real member object and not assuming what the receiver wants.
                member: member || ({ userId } as User),
            });
            return success();
        },
        category: CommandCategories.advanced,
    }),
    new Command({
        command: "rageshake",
        aliases: ["bugreport"],
        description: _td("Send a bug report with logs"),
        isEnabled: () => !!SdkConfig.get().bug_report_endpoint_url,
        args: "<description>",
        runFn: function (cli, roomId, threadId, args) {
            return success(
                Modal.createDialog(BugReportDialog, {
                    initialText: args,
                }).finished,
            );
        },
        category: CommandCategories.advanced,
    }),
    new Command({
        command: "tovirtual",
        description: _td("Switches to this room's virtual room, if it has one"),
        category: CommandCategories.advanced,
        isEnabled(cli): boolean {
            return !!LegacyCallHandler.instance.getSupportsVirtualRooms() && !isCurrentLocalRoom(cli);
        },
        runFn: (cli, roomId) => {
            return success(
                (async (): Promise<void> => {
                    const room = await VoipUserMapper.sharedInstance().getVirtualRoomForRoom(roomId);
                    if (!room) throw new UserFriendlyError("No virtual room for this room");
                    dis.dispatch<ViewRoomPayload>({
                        action: Action.ViewRoom,
                        room_id: room.roomId,
                        metricsTrigger: "SlashCommand",
                        metricsViaKeyboard: true,
                    });
                })(),
            );
        },
    }),
    new Command({
        command: "query",
        description: _td("Opens chat with the given user"),
        args: "<user-id>",
        runFn: function (cli, roomId, threadId, userId) {
            // easter-egg for now: look up phone numbers through the thirdparty API
            // (very dumb phone number detection...)
            const isPhoneNumber = userId && /^\+?[0123456789]+$/.test(userId);
            if (!userId || ((!userId.startsWith("@") || !userId.includes(":")) && !isPhoneNumber)) {
                return reject(this.getUsage());
            }

            return success(
                (async (): Promise<void> => {
                    if (isPhoneNumber) {
                        const results = await LegacyCallHandler.instance.pstnLookup(userId);
                        if (!results || results.length === 0 || !results[0].userid) {
                            throw new UserFriendlyError("Unable to find Matrix ID for phone number");
                        }
                        userId = results[0].userid;
                    }

                    const roomId = await ensureDMExists(cli, userId);
                    if (!roomId) throw new Error("Failed to ensure DM exists");

                    dis.dispatch<ViewRoomPayload>({
                        action: Action.ViewRoom,
                        room_id: roomId,
                        metricsTrigger: "SlashCommand",
                        metricsViaKeyboard: true,
                    });
                })(),
            );
        },
        category: CommandCategories.actions,
    }),
    new Command({
        command: "msg",
        description: _td("Sends a message to the given user"),
        args: "<user-id> [<message>]",
        runFn: function (cli, roomId, threadId, args) {
            if (args) {
                // matches the first whitespace delimited group and then the rest of the string
                const matches = args.match(/^(\S+?)(?: +(.*))?$/s);
                if (matches) {
                    const [userId, msg] = matches.slice(1);
                    if (userId && userId.startsWith("@") && userId.includes(":")) {
                        return success(
                            (async (): Promise<void> => {
                                const roomId = await ensureDMExists(cli, userId);
                                if (!roomId) throw new Error("Failed to ensure DM exists");

                                dis.dispatch<ViewRoomPayload>({
                                    action: Action.ViewRoom,
                                    room_id: roomId,
                                    metricsTrigger: "SlashCommand",
                                    metricsViaKeyboard: true,
                                });
                                if (msg) {
                                    cli.sendTextMessage(roomId, msg);
                                }
                            })(),
                        );
                    }
                }
            }

            return reject(this.getUsage());
        },
        category: CommandCategories.actions,
    }),
    new Command({
        command: "holdcall",
        description: _td("Places the call in the current room on hold"),
        category: CommandCategories.other,
        isEnabled: (cli) => !isCurrentLocalRoom(cli),
        runFn: function (cli, roomId, threadId, args) {
            const call = LegacyCallHandler.instance.getCallForRoom(roomId);
            if (!call) {
                return reject(new UserFriendlyError("No active call in this room"));
            }
            call.setRemoteOnHold(true);
            return success();
        },
        renderingTypes: [TimelineRenderingType.Room],
    }),
    new Command({
        command: "unholdcall",
        description: _td("Takes the call in the current room off hold"),
        category: CommandCategories.other,
        isEnabled: (cli) => !isCurrentLocalRoom(cli),
        runFn: function (cli, roomId, threadId, args) {
            const call = LegacyCallHandler.instance.getCallForRoom(roomId);
            if (!call) {
                return reject(new UserFriendlyError("No active call in this room"));
            }
            call.setRemoteOnHold(false);
            return success();
        },
        renderingTypes: [TimelineRenderingType.Room],
    }),
    new Command({
        command: "converttodm",
        description: _td("Converts the room to a DM"),
        category: CommandCategories.other,
        isEnabled: (cli) => !isCurrentLocalRoom(cli),
        runFn: function (cli, roomId, threadId, args) {
            const room = cli.getRoom(roomId);
            if (!room) return reject(new UserFriendlyError("Could not find room"));
            return success(guessAndSetDMRoom(room, true));
        },
        renderingTypes: [TimelineRenderingType.Room],
    }),
    new Command({
        command: "converttoroom",
        description: _td("Converts the DM to a room"),
        category: CommandCategories.other,
        isEnabled: (cli) => !isCurrentLocalRoom(cli),
        runFn: function (cli, roomId, threadId, args) {
            const room = cli.getRoom(roomId);
            if (!room) return reject(new UserFriendlyError("Could not find room"));
            return success(guessAndSetDMRoom(room, false));
        },
        renderingTypes: [TimelineRenderingType.Room],
    }),

    // Command definitions for autocompletion ONLY:
    // /me is special because its not handled by SlashCommands.js and is instead done inside the Composer classes
    new Command({
        command: "me",
        args: "<message>",
        description: _td("Displays action"),
        category: CommandCategories.messages,
        hideCompletionAfterSpace: true,
    }),

    ...CHAT_EFFECTS.map((effect) => {
        return new Command({
            command: effect.command,
            description: effect.description(),
            args: "<message>",
            runFn: function (cli, roomId, threadId, args) {
                let content: IContent;
                if (!args) {
                    content = ContentHelpers.makeEmoteMessage(effect.fallbackMessage());
                } else {
                    content = {
                        msgtype: effect.msgType,
                        body: args,
                    };
                }
                dis.dispatch({ action: `effects.${effect.command}` });
                return successSync(content);
            },
            category: CommandCategories.effects,
            renderingTypes: [TimelineRenderingType.Room],
        });
    }),
];

// build a map from names and aliases to the Command objects.
export const CommandMap = new Map<string, Command>();
Commands.forEach((cmd) => {
    CommandMap.set(cmd.command, cmd);
    cmd.aliases.forEach((alias) => {
        CommandMap.set(alias, cmd);
    });
});

export function parseCommandString(input: string): { cmd?: string; args?: string } {
    // trim any trailing whitespace, as it can confuse the parser for IRC-style commands
    input = input.trimEnd();
    if (input[0] !== "/") return {}; // not a command

    const bits = input.match(/^(\S+?)(?:[ \n]+((.|\n)*))?$/);
    let cmd: string;
    let args: string | undefined;
    if (bits) {
        cmd = bits[1].substring(1).toLowerCase();
        args = bits[2];
    } else {
        cmd = input;
    }

    return { cmd, args };
}

interface ICmd {
    cmd?: Command;
    args?: string;
}

/**
 * Process the given text for /commands and returns a parsed command that can be used for running the operation.
 * @param {string} input The raw text input by the user.
 * @return {ICmd} The parsed command object.
 * Returns an empty object if the input didn't match a command.
 */
export function getCommand(input: string): ICmd {
    const { cmd, args } = parseCommandString(input);

    if (cmd && CommandMap.has(cmd) && CommandMap.get(cmd)!.isEnabled(MatrixClientPeg.get())) {
        return {
            cmd: CommandMap.get(cmd),
            args,
        };
    }
    return {};
}
