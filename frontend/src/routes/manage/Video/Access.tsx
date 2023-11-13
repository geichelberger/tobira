import { useTranslation } from "react-i18next";
import { Breadcrumbs } from "../../../ui/Breadcrumbs";
import { AuthorizedEvent, makeManageVideoRoute } from "./Shared";
import { PageTitle } from "../../../layout/header/ui";
import { Dispatch, RefObject, SetStateAction, useRef, useState } from "react";
import { COLORS } from "../../../color";
import { FiInfo } from "react-icons/fi";
import { Button, Kind as ButtonKind } from "../../../ui/Button";
import { isRealUser, useUser } from "../../../User";
import { NotAuthorized } from "../../../ui/error";
import { WithTooltip } from "@opencast/appkit";
import { Modal, ModalHandle } from "../../../ui/Modal";
import { currentRef, keyOfId } from "../../../util";
import { COMMON_ROLES } from "../../../util/roles";
import { Acl, AclSelector, knownRolesFragement } from "../../../ui/Access";
import { useNavBlocker } from "../../util";
import { useFragment } from "react-relay";
import {
    AccessKnownRolesData$data,
    AccessKnownRolesData$key,
} from "../../../ui/__generated__/AccessKnownRolesData.graphql";


export const ManageVideoAccessRoute = makeManageVideoRoute(
    "acl",
    "/access",
    (event, data) => <AclPage event={event} data={data} />,
);

type AclPageProps = {
    event: AuthorizedEvent;
    data: AccessKnownRolesData$key;
};

const AclPage: React.FC<AclPageProps> = ({ event, data }) => {
    const { t } = useTranslation();
    const user = useUser();

    if (!isRealUser(user)) {
        return <NotAuthorized />;
    }

    const knownRoles = useFragment(knownRolesFragement, data);

    const breadcrumbs = [
        { label: t("user.manage-content"), link: "/~manage" },
        { label: t("manage.my-videos.title"), link: "/~manage/videos" },
        { label: event.title, link: `/~manage/videos/${keyOfId(event.id)}` },
    ];

    return <>
        <Breadcrumbs path={breadcrumbs} tail={t("manage.my-videos.acl.title")} />
        <PageTitle title={t("manage.my-videos.acl.title")} />
        {event.hostRealms.length < 1 && <UnlistedNote />}
        <AccessUI {...{ event, knownRoles }} />
    </>;
};


const UnlistedNote: React.FC = () => {
    const { t } = useTranslation();

    return (
        <WithTooltip
            tooltip={t("manage.access.unlisted.explanation")}
            placement="bottom"
            tooltipCss={{ width: 400 }}
            css={{ display: "inline-block" }}
        >
            <div css={{
                fontSize: 14,
                lineHeight: 1,
                color: COLORS.neutral60,
                display: "flex",
                gap: 4,
                marginBottom: 16,
            }}>
                <FiInfo />
                {t("manage.access.unlisted.note")}
            </div>
        </WithTooltip>
    );
};

type AccessUIProps = {
    event: AuthorizedEvent;
    knownRoles: AccessKnownRolesData$data;
}

const AccessUI: React.FC<AccessUIProps> = ({ event, knownRoles }) => {

    const initialAcl: Acl = {
        readRoles: new Set(event.readRoles),
        writeRoles: new Set(event.writeRoles),
    };

    const [selections, setSelections] = useState<Acl>(initialAcl);

    return (
        <div css={{ maxWidth: 1040 }}>
            <div css={{
                display: "flex",
                flexDirection: "column",
                width: "100%",
            }}>
                <AclSelector acl={selections} onChange={setSelections} knownRoles={knownRoles} />
                <ButtonWrapper {...{ selections, setSelections, initialAcl }} />
            </div>
        </div>
    );
};

type ButtonWrapperProps = {
    selections: Acl;
    setSelections: Dispatch<SetStateAction<Acl>>;
    initialAcl: Acl;
}

const ButtonWrapper: React.FC<ButtonWrapperProps> = ({ selections, setSelections, initialAcl }) => {
    const { t } = useTranslation();
    const user = useUser();
    const saveModalRef = useRef<ModalHandle>(null);
    const resetModalRef = useRef<ModalHandle>(null);

    const containsUser = (acl: Acl) => isRealUser(user)
        && user.roles.some(r => r === COMMON_ROLES.ADMIN || acl.writeRoles.has(r));

    const compareSets = (a: Set<string>, b: Set<string>) =>
        a.size === b.size && [...a].every((str => b.has(str)));

    const selectionIsInitial = compareSets(selections.readRoles, initialAcl.readRoles)
        && compareSets(selections.writeRoles, initialAcl.writeRoles);

    const submit = async (acl: Acl) => {
        // TODO: Actually save new ACL.
        // eslint-disable-next-line no-console
        console.log(acl);
    };

    useNavBlocker(!selectionIsInitial);

    return <div css={{ display: "flex", gap: 8, alignSelf: "flex-start", marginTop: 40 }}>
        {/* Reset button */}
        <ButtonWithModal
            buttonKind="danger"
            modalRef={resetModalRef}
            label={t("manage.access.reset-modal.label")}
            title={t("manage.access.reset-modal.title")}
            body={t("manage.access.reset-modal.body")}
            confirmationLabel={t("manage.access.reset-modal.label")}
            handleClick={() => currentRef(resetModalRef).open()}
            onConfirm={() => setSelections(initialAcl)}
            disabled={selectionIsInitial}
        />
        {/* Save button */}
        <ButtonWithModal
            buttonKind="happy"
            modalRef={saveModalRef}
            label={t("general.action.save")}
            title={t("manage.access.save-modal.title")}
            body={t("manage.access.save-modal.body")}
            confirmationLabel={t("manage.access.save-modal.confirm")}
            handleClick={() => !containsUser(selections)
                ? currentRef(saveModalRef).open()
                : submit(selections)}
            onConfirm={() => submit(selections)}
            disabled={selectionIsInitial}
        />
    </div>;
};

type ButtonWithModalProps = {
    buttonKind: ButtonKind;
    modalRef: RefObject<ModalHandle>;
    label: string;
    title: string;
    body: string;
    confirmationLabel: string;
    handleClick: () => void;
    onConfirm: () => void;
    disabled?: boolean;
}

const ButtonWithModal: React.FC<ButtonWithModalProps> = ({ ...props }) => {
    const { t } = useTranslation();
    return <>
        <Button
            kind={props.buttonKind}
            onClick={props.handleClick}
            disabled={props.disabled}
        >{props.label}</Button>
        <Modal ref={props.modalRef} title={props.title}>
            <p>{props.body}</p>
            <div css={{
                display: "flex",
                gap: 12,
                justifyContent: "center",
                flexWrap: "wrap",
                marginTop: 32,
            }}>
                <Button onClick={() => currentRef(props.modalRef).close?.()}>
                    {t("general.action.cancel")}
                </Button>
                <Button kind="danger" onClick={() => {
                    props.onConfirm();
                    currentRef(props.modalRef).close?.();
                }}>{props.confirmationLabel}</Button>
            </div>
        </Modal>
    </>;
};
