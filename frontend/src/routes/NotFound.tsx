import { Trans, useTranslation } from "react-i18next";
import { graphql } from "react-relay";

import { RootLoader } from "../layout/Root";
import { Link } from "../router";
import { match } from "../util";
import { loadQuery } from "../relay";
import { ErrorPage } from "../ui/error";
import { NotFoundQuery } from "./__generated__/NotFoundQuery.graphql";


export const NotFoundRoute = {
    prepare: () => {
        const queryRef = loadQuery<NotFoundQuery>(query, {});
        return {
            render: () => <RootLoader
                {...{ query, queryRef }}
                nav={() => []}
                render={() => <NotFound kind="page" />}
            />,
            dispose: () => queryRef.dispose(),
        };
    },
};

const query = graphql`
    query NotFoundQuery { ... UserData }
`;

type Props = {
    kind: "page" | "video" | "series";
};

export const NotFound: React.FC<Props> = ({ kind }) => {
    const { t } = useTranslation();
    const title = match(kind, {
        "page": () => t("not-found.page-not-found"),
        "video": () => t("not-found.video-not-found"),
        "series": () => t("not-found.series-not-found"),
    });

    return <ErrorPage title={title}>
        <p css={{ margin: "16px 0" }}>
            {match(kind, {
                "page": () => t("not-found.page-explanation"),
                "video": () => t("not-found.video-explanation"),
                "series": () => t("not-found.series-explanation"),
            })}
            {t("not-found.url-typo")}
        </p>
        <Trans i18nKey="not-found.actions">
            You can try visiting <Link to="/">the homepage</Link> or using
            the search bar to find the page you are looking for.
        </Trans>
    </ErrorPage>;
};
