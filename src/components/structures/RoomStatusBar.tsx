/*
Copyright 2015-2021 The Matrix.org Foundation C.I.C.

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

import React, { ReactNode } from "react";
import { EventStatus, MatrixEvent, Room, MatrixError, SyncState, SyncStateData } from "matrix-js-sdk/src/matrix";

import { Icon as WarningIcon } from "../../../res/img/feather-customised/warning-triangle.svg";
import { _t, _td } from "../../languageHandler";
import Resend from "../../Resend";
import dis from "../../dispatcher/dispatcher";
import { messageForResourceLimitError } from "../../utils/ErrorUtils";
import { Action } from "../../dispatcher/actions";
import { StaticNotificationState } from "../../stores/notifications/StaticNotificationState";
import AccessibleButton from "../views/elements/AccessibleButton";
import InlineSpinner from "../views/elements/InlineSpinner";
import MatrixClientContext from "../../contexts/MatrixClientContext";
import { RoomStatusBarUnsentMessages } from "./RoomStatusBarUnsentMessages";
import ExternalLink from "../views/elements/ExternalLink";

const STATUS_BAR_HIDDEN = 0;
const STATUS_BAR_EXPANDED = 1;
const STATUS_BAR_EXPANDED_LARGE = 2;

export function getUnsentMessages(room: Room, threadId?: string): MatrixEvent[] {
    if (!room) {
        return [];
    }
    return room.getPendingEvents().filter(function (ev) {
        const isNotSent = ev.status === EventStatus.NOT_SENT;
        const belongsToTheThread = threadId === ev.threadRootId;
        return isNotSent && (!threadId || belongsToTheThread);
    });
}

interface IProps {
    // the room this statusbar is representing.
    room: Room;

    // true if the room is being peeked at. This affects components that shouldn't
    // logically be shown when peeking, such as a prompt to invite people to a room.
    isPeeking?: boolean;
    // callback for when the user clicks on the 'resend all' button in the
    // 'unsent messages' bar
    onResendAllClick?: () => void;

    // callback for when the user clicks on the 'cancel all' button in the
    // 'unsent messages' bar
    onCancelAllClick?: () => void;

    // callback for when the user clicks on the 'invite others' button in the
    // 'you are alone' bar
    onInviteClick?: () => void;

    // callback for when we do something that changes the size of the
    // status bar. This is used to trigger a re-layout in the parent
    // component.
    onResize?: () => void;

    // callback for when the status bar can be hidden from view, as it is
    // not displaying anything
    onHidden?: () => void;

    // callback for when the status bar is displaying something and should
    // be visible
    onVisible?: () => void;
}

interface IState {
    syncState: SyncState;
    syncStateData: SyncStateData;
    unsentMessages: MatrixEvent[];
    isResending: boolean;
}

export default class RoomStatusBar extends React.PureComponent<IProps, IState> {
    private unmounted = false;
    public static contextType = MatrixClientContext;

    public constructor(props: IProps, context: typeof MatrixClientContext) {
        super(props, context);

        this.state = {
            syncState: this.context.getSyncState(),
            syncStateData: this.context.getSyncStateData(),
            unsentMessages: getUnsentMessages(this.props.room),
            isResending: false,
        };
    }

    public componentDidMount(): void {
        const client = this.context;
        client.on("sync", this.onSyncStateChange);
        client.on("Room.localEchoUpdated", this.onRoomLocalEchoUpdated);

        this.checkSize();
    }

    public componentDidUpdate(): void {
        this.checkSize();
    }

    public componentWillUnmount(): void {
        this.unmounted = true;
        // we may have entirely lost our client as we're logging out before clicking login on the guest bar...
        const client = this.context;
        if (client) {
            client.removeListener("sync", this.onSyncStateChange);
            client.removeListener("Room.localEchoUpdated", this.onRoomLocalEchoUpdated);
        }
    }

    private onSyncStateChange = (state: SyncState, prevState: SyncState, data: SyncStateData): void => {
        if (state === "SYNCING" && prevState === "SYNCING") {
            return;
        }
        if (this.unmounted) return;
        this.setState({
            syncState: state,
            syncStateData: data,
        });
    };

    private onResendAllClick = (): void => {
        Resend.resendUnsentEvents(this.props.room).then(() => {
            this.setState({ isResending: false });
        });
        this.setState({ isResending: true });
        dis.fire(Action.FocusSendMessageComposer);
    };

    private onCancelAllClick = (): void => {
        Resend.cancelUnsentEvents(this.props.room);
        dis.fire(Action.FocusSendMessageComposer);
    };

    private onRoomLocalEchoUpdated = (ev: MatrixEvent, room: Room): void => {
        if (room.roomId !== this.props.room.roomId) return;
        const messages = getUnsentMessages(this.props.room);
        this.setState({
            unsentMessages: messages,
            isResending: messages.length > 0 && this.state.isResending,
        });
    };

    // Check whether current size is greater than 0, if yes call props.onVisible
    private checkSize(): void {
        if (this.getSize()) {
            if (this.props.onVisible) this.props.onVisible();
        } else {
            if (this.props.onHidden) this.props.onHidden();
        }
    }

    // We don't need the actual height - just whether it is likely to have
    // changed - so we use '0' to indicate normal size, and other values to
    // indicate other sizes.
    private getSize(): number {
        if (this.shouldShowConnectionError()) {
            return STATUS_BAR_EXPANDED;
        } else if (this.state.unsentMessages.length > 0 || this.state.isResending) {
            return STATUS_BAR_EXPANDED_LARGE;
        }
        return STATUS_BAR_HIDDEN;
    }

    private shouldShowConnectionError(): boolean {
        // no conn bar trumps the "some not sent" msg since you can't resend without
        // a connection!
        // There's one situation in which we don't show this 'no connection' bar, and that's
        // if it's a resource limit exceeded error: those are shown in the top bar.
        const errorIsMauError = Boolean(
            this.state.syncStateData &&
                this.state.syncStateData.error &&
                this.state.syncStateData.error.name === "M_RESOURCE_LIMIT_EXCEEDED",
        );
        return this.state.syncState === "ERROR" && !errorIsMauError;
    }

    private getUnsentMessageContent(): JSX.Element {
        const unsentMessages = this.state.unsentMessages;

        let title: ReactNode;

        let consentError: MatrixError | null = null;
        let resourceLimitError: MatrixError | null = null;
        for (const m of unsentMessages) {
            if (m.error && m.error.errcode === "M_CONSENT_NOT_GIVEN") {
                consentError = m.error;
                break;
            } else if (m.error && m.error.errcode === "M_RESOURCE_LIMIT_EXCEEDED") {
                resourceLimitError = m.error;
                break;
            }
        }
        if (consentError) {
            title = _t(
                "You can't send any messages until you review and agree to <consentLink>our terms and conditions</consentLink>.",
                {},
                {
                    consentLink: (sub) => (
                        <ExternalLink href={consentError!.data?.consent_uri} target="_blank" rel="noreferrer noopener">
                            {sub}
                        </ExternalLink>
                    ),
                },
            );
        } else if (resourceLimitError) {
            title = messageForResourceLimitError(
                resourceLimitError.data.limit_type,
                resourceLimitError.data.admin_contact,
                {
                    "monthly_active_user": _td(
                        "Your message wasn't sent because this homeserver has hit its Monthly Active User Limit. Please <a>contact your service administrator</a> to continue using the service.",
                    ),
                    "hs_disabled": _td(
                        "Your message wasn't sent because this homeserver has been blocked by its administrator. Please <a>contact your service administrator</a> to continue using the service.",
                    ),
                    "": _td(
                        "Your message wasn't sent because this homeserver has exceeded a resource limit. Please <a>contact your service administrator</a> to continue using the service.",
                    ),
                },
            );
        } else {
            title = _t("Some of your messages have not been sent");
        }

        let buttonRow = (
            <>
                <AccessibleButton onClick={this.onCancelAllClick} className="mx_RoomStatusBar_unsentCancelAllBtn">
                    {_t("Delete all")}
                </AccessibleButton>
                <AccessibleButton onClick={this.onResendAllClick} className="mx_RoomStatusBar_unsentRetry">
                    {_t("Retry all")}
                </AccessibleButton>
            </>
        );
        if (this.state.isResending) {
            buttonRow = (
                <>
                    <InlineSpinner w={20} h={20} />
                    {/* span for css */}
                    <span>{_t("Sending")}</span>
                </>
            );
        }

        return (
            <RoomStatusBarUnsentMessages
                title={title}
                description={_t("You can select all or individual messages to retry or delete")}
                notificationState={StaticNotificationState.RED_EXCLAMATION}
                buttons={buttonRow}
            />
        );
    }

    public render(): React.ReactNode {
        if (this.shouldShowConnectionError()) {
            return (
                <div className="mx_RoomStatusBar">
                    <div role="alert">
                        <div className="mx_RoomStatusBar_connectionLostBar">
                            <WarningIcon width="24" height="24" />
                            <div>
                                <div className="mx_RoomStatusBar_connectionLostBar_title">
                                    {_t("Connectivity to the server has been lost.")}
                                </div>
                                <div className="mx_RoomStatusBar_connectionLostBar_desc">
                                    {_t("Sent messages will be stored until your connection has returned.")}
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            );
        }

        if (this.state.unsentMessages.length > 0 || this.state.isResending) {
            return this.getUnsentMessageContent();
        }

        return null;
    }
}
