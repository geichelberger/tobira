use chrono::{DateTime, Utc};
use tokio_postgres::Row;
use juniper::{GraphQLObject, graphql_object};

use crate::{
    api::{Context, err::ApiResult, Id, model::series::Series},
    db::types::{EventTrack, Key},
    prelude::*,
};


pub(crate) struct Event {
    key: Key,
    series: Option<Key>,

    title: String,
    description: Option<String>,
    duration: Option<i32>,
    created: DateTime<Utc>,
    updated: DateTime<Utc>,
    creator: Option<String>,

    thumbnail: Option<String>,
    tracks: Vec<Track>,
}

#[derive(GraphQLObject)]
struct Track {
    uri: String,
    flavor: String,
    mimetype: Option<String>,
    // TODO: this should be `[i32; 2]` but the relevant patch is not released
    // yet: https://github.com/graphql-rust/juniper/pull/966
    resolution: Option<Vec<i32>>,
}

#[graphql_object(Context = Context)]
impl Event {
    fn id(&self) -> Id {
        Id::event(self.key)
    }
    fn title(&self) -> &str {
        &self.title
    }
    fn description(&self) -> Option<&str> {
        self.description.as_deref()
    }
    /// Duration in ms.
    fn duration(&self) -> Option<f64> {
        self.duration.map(Into::into)
    }
    fn thumbnail(&self) -> Option<&str> {
        self.thumbnail.as_deref()
    }
    fn tracks(&self) -> &[Track] {
        &self.tracks
    }
    fn created(&self) -> DateTime<Utc> {
        self.created
    }
    fn updated(&self) -> DateTime<Utc> {
        self.updated
    }
    fn creator(&self) -> &Option<String> {
        &self.creator
    }

    async fn series(&self, context: &Context) -> ApiResult<Option<Series>> {
        if let Some(series) = self.series {
            Series::load_by_id(Id::series(series), context).await
        } else {
            Ok(None)
        }
    }
}

impl Event {
    pub(crate) async fn load_by_id(id: Id, context: &Context) -> ApiResult<Option<Self>> {
        let result = if let Some(key) = id.key_for(Id::EVENT_KIND) {
            context.db
                .query_opt(
                    &*format!("select {} from events where id = $1", Self::COL_NAMES),
                    &[&key],
                )
                .await?
                .map(Self::from_row)
        } else {
            None
        };

        Ok(result)
    }

    pub(crate) async fn load_for_series(series_key: Key, context: &Context) -> ApiResult<Vec<Self>> {
        let result = context.db
            .query_raw(
                &*format!("select {} from events where series = $1", Self::COL_NAMES),
                &[series_key],
            )
            .await?
            .map_ok(Self::from_row)
            .try_collect()
            .await?;

        Ok(result)
    }

    const COL_NAMES: &'static str
        = "id, series, title, description, duration, created, updated, creator, thumbnail, tracks";

    fn from_row(row: Row) -> Self {
        Self {
            key: row.get(0),
            series: row.get(1),
            title: row.get(2),
            description: row.get(3),
            duration: row.get(4),
            created: row.get(5),
            updated: row.get(6),
            creator: row.get(7),
            thumbnail: row.get(8),
            tracks: row.get::<_, Vec<EventTrack>>(9).into_iter().map(Track::from).collect(),
        }
    }
}

impl From<EventTrack> for Track {
    fn from(src: EventTrack) -> Self {
        Self {
            uri: src.uri,
            flavor: src.flavor,
            mimetype: src.mimetype,
            resolution: src.resolution.map(Into::into),
        }
    }
}