import React from "react";
import { useTranslation } from "react-i18next";
import { useFragment, graphql, useMutation } from "react-relay";
import { FiArrowDown, FiArrowUp } from "react-icons/fi";

import type { MoveButtonsData$key } from "../../../../../query-types/MoveButtonsData.graphql";
import type { MoveButtonsMutation } from "../../../../../query-types/MoveButtonsMutation.graphql";
import { Button } from "../util";


type Props = {
    realm: MoveButtonsData$key;
    index: number;
    onCommit?: () => void;
    onCompleted?: () => void;
    onError?: (error: Error) => void;
};

export const MoveButtons: React.FC<Props> = ({
    realm,
    index,
    onCommit,
    onCompleted,
    onError,
}) => {
    const { t } = useTranslation();


    const { id: realmId, blocks } = useFragment(graphql`
        fragment MoveButtonsData on Realm {
            id
            # We need this list only for the length,
            # but we have to query *something* from it.
            blocks { id }
        }
    `, realm);


    const [commitMove] = useMutation<MoveButtonsMutation>(graphql`
        mutation MoveButtonsMutation($realmId: ID!, $indexA: Int!, $indexB: Int!) {
            swapBlocksByIndex(realm: $realmId, indexA: $indexA, indexB: $indexB) {
                ... ContentManageRealmData
            }
        }
    `);

    const move = (direction: -1 | 1) => {
        commitMove({
            variables: {
                realmId,
                indexA: index,
                indexB: index + direction,
            },
            onCompleted,
            onError,
        });
        onCommit?.();
    };


    return <>
        <Button
            title={t("manage.realm.content.move-down")}
            disabled={index === blocks.length - 1}
            onClick={() => move(1)}
        >
            <FiArrowDown />
        </Button>
        <Button
            title={t("manage.realm.content.move-up")}
            disabled={index === 0}
            onClick={() => move(-1)}
        >
            <FiArrowUp />
        </Button>
    </>;
};