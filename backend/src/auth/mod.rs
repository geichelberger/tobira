use std::{borrow::Cow, time::Duration};

use deadpool_postgres::Client;
use hyper::HeaderMap;
use once_cell::sync::Lazy;
use tokio_postgres::Error as PgError;

use crate::{config::TranslatedString, prelude::*};


mod handlers;
mod session_id;
mod jwt;

pub(crate) use self::{
    session_id::SessionId,
    jwt::{JwtConfig, JwtContext},
    handlers::{handle_login, handle_logout},
};


/// Users with this role can do anything as they are the global Opencast
/// administrator.
pub(crate) const ROLE_ADMIN: &str = "ROLE_ADMIN";

const ROLE_ANONYMOUS: &str = "ROLE_ANONYMOUS";

const SESSION_COOKIE: &str = "tobira-session";


/// Authentification and authorization
#[derive(Debug, Clone, confique::Config)]
pub(crate) struct AuthConfig {
    /// The mode of authentication. Compare the authentication docs! Possible values:
    ///
    /// - "none": Tobira never reads auth headers and thus, users cannot login
    ///    at all. Only useful for development and as safe default.
    /// - "full-auth-proxy": Tobira does no session handling and expects an auth
    ///   proxy in front of every route, passing user info via auth headers.
    /// - "login-proxy": Tobira does its own session handling and expects the auth
    ///    system to send `POST /~session` with auth headers to create a session.
    ///
    /// **Important**: in either case, you HAVE to make sure to remove all auth
    /// headers from incoming user requests before passing them on to Tobira!
    #[config(default = "none")]
    pub(crate) mode: AuthMode,

    /// Link of the login button. If not set, the login button internally
    /// (not via `<a>`, but through JavaScript) links to Tobira's own login page.
    pub(crate) login_link: Option<String>,

    /// Link of the logout button. If not set, clicking the logout button will
    /// send a `DELETE` request to `/~session`.
    pub(crate) logout_link: Option<String>,

    /// The header containing a unique and stable username of the current user.
    /// TODO: describe properties, requirements and usages of username.
    #[config(default = "x-tobira-username")]
    pub(crate) username_header: String,

    /// The header containing the human-readable name of the current user
    /// (e.g. "Peter Lustig").
    #[config(default = "x-tobira-user-display-name")]
    pub(crate) display_name_header: String,

    /// The header containing a comma-separated list of roles of the current user.
    #[config(default = "x-tobira-user-roles")]
    pub(crate) roles_header: String,

    /// If a user has this role, they are treated as a moderator in Tobira,
    /// giving them the ability to modify the realm structure among other
    /// things.
    #[config(default = "ROLE_TOBIRA_MODERATOR")]
    pub(crate) moderator_role: String,

    /// If a user has this role, they are allowed to use the Tobira video
    /// uploader to ingest videos to Opencast.
    #[config(default = "ROLE_TOBIRA_UPLOAD")]
    pub(crate) upload_role: String,

    /// If a user has this role, they are allowed to use Opencast Studio to
    /// record and upload videos.
    #[config(default = "ROLE_TOBIRA_STUDIO")]
    pub(crate) studio_role: String,

    /// If a user has this role, they are allowed to use the Opencast editor to
    /// edit videos they have write access to.
    #[config(default = "ROLE_TOBIRA_EDITOR")]
    pub(crate) editor_role: String,

    /// Duration of a Tobira-managed login session.
    /// Note: This is only relevant if `auth.mode` is `login-proxy`.
    #[config(default = "30d", deserialize_with = crate::config::deserialize_duration)]
    pub(crate) session_duration: Duration,

    /// Configuration related to the built-in login page.
    #[config(nested)]
    pub(crate) login_page: LoginPageConfig,

    /// JWT configuration. JWTs are only used to automatically authenticate
    /// users against Opencast with short-lived tokens. They are not used for
    /// user sessions.
    #[config(nested)]
    pub(crate) jwt: JwtConfig,
}

/// Authentification and authorization
#[derive(Debug, Clone, confique::Config)]
pub(crate) struct LoginPageConfig {
    /// Label for the user-ID field. If not set, "User ID" is used.
    pub(crate) user_id_label: Option<TranslatedString>,

    /// Label for the password field. If not set, "Password" is used.
    pub(crate) password_label: Option<TranslatedString>,

    /// An additional note that is displayed on the login page. If not set, no
    /// additional note is shown.
    pub(crate) note: Option<TranslatedString>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Deserialize)]
#[serde(rename_all = "kebab-case")]
pub(crate) enum AuthMode {
    None,
    FullAuthProxy,
    LoginProxy,
}

/// Data about a user.
#[derive(Debug)]
pub(crate) struct User {
    pub(crate) username: String,
    pub(crate) display_name: String,
    pub(crate) roles: Vec<String>,
}

/// Returns a representation of the optional username useful for logging.
pub(crate) fn debug_log_username(session: &Option<User>) -> Cow<'static, str> {
    match session {
        None => "none".into(),
        Some(user) => format!("'{}'", user.username).into(),
    }
}

impl User {
    /// Obtains the current user from the given request headers. This is done
    /// either via auth headers and/or a session cookie, depending on the
    /// configuration.
    pub(crate) async fn new(
        headers: &HeaderMap,
        auth_config: &AuthConfig,
        db: &Client,
    ) -> Result<Option<Self>, PgError> {
        match auth_config.mode {
            AuthMode::None => Ok(None),
            AuthMode::FullAuthProxy => Ok(Self::from_auth_headers(headers, auth_config).into()),
            AuthMode::LoginProxy => Self::from_session(headers, db, auth_config.session_duration)
                .await
                .map(Into::into),
        }
    }

    /// Tries to read user data auth headers (`x-tobira-username`, ...). If the
    /// username or display name are not defined, returns `None`.
    pub(crate) fn from_auth_headers(headers: &HeaderMap, auth_config: &AuthConfig) -> Option<Self> {
        // Helper function to read and base64 decode a header value.
        let get_header = |header_name: &str| -> Option<String> {
            let value = headers.get(header_name)?;
            let decoded = base64decode(value.as_bytes())
                .map_err(|e| warn!("header '{}' is set but not valid base64: {}", header_name, e))
                .ok()?;

            String::from_utf8(decoded)
                .map_err(|e| warn!("header '{}' is set but decoded base64 is not UTF8: {}", header_name, e))
                .ok()
        };

        // Get required headers. If these are not set and valid, we treat it as
        // if there is no user session.
        let username = get_header(&auth_config.username_header)?;
        let display_name = get_header(&auth_config.display_name_header)?;

        // Get roles from the user. If the header is not set, the user simply has no extra roles.
        let mut roles = vec![ROLE_ANONYMOUS.to_string()];
        if let Some(roles_raw) = get_header(&auth_config.roles_header) {
            roles.extend(roles_raw.split(',').map(|role| role.trim().to_owned()));
        };

        Some(Self { username, display_name, roles })
    }

    /// Tries to load user data from a DB session referred to in a session
    /// cookie. Should only be called if the auth mode is `LoginProxy`.
    async fn from_session(
        headers: &HeaderMap,
        db: &Client,
        session_duration: Duration,
    ) -> Result<Option<Self>, PgError> {
        // Try to get a session ID from the cookie.
        let session_id = match SessionId::from_headers(headers) {
            None => return Ok(None),
            Some(id) => id,
        };

        // Check if such a session exists in the DB.
        let sql = "select username, display_name, roles from user_sessions \
            where id = $1 \
            and extract(epoch from now() - created) < $2";
        let row = match db.query_opt(sql, &[&session_id, &session_duration.as_secs_f64()]).await? {
            None => return Ok(None),
            Some(row) => row,
        };

        Ok(Some(Self {
            username: row.get(0),
            display_name: row.get(1),
            roles: row.get(2),
        }))
    }

    /// Creates a new session for this user and persists it in the database.
    /// Should only be called if the auth mode is `LoginProxy`.
    pub(crate) async fn persist_new_session(&self, db: &Client) -> Result<SessionId, PgError> {
        let session_id = SessionId::new();

        // A collision is so unfathomably unlikely that we don't check for it
        // here. We just pass the error up and respond with 500. Note that
        // Postgres will always error in case of collision, so security is
        // never compromised.
        db.execute_raw(
            "insert into \
                user_sessions (id, username, display_name, roles) \
                values ($1, $2, $3, $4)",
            dbargs![&session_id, &self.username, &self.display_name, &self.roles],
        ).await?;

        Ok(session_id)
    }
}


/// A marker type that serves to prove *some* user authorization has been done.
///
/// The goal of this is to prevent devs from forgetting to do authorization at
/// all. Since the token does not contain any information about what was
/// authorized, it cannot protect against anything else.
///
/// Has a private field so it cannot be created outside of this module.
pub(crate) struct AuthToken(());

impl AuthToken {
    fn some_if(v: bool) -> Option<Self> {
        if v { Some(Self(())) } else { None }
    }
}

// Our base64 decoding with the URL safe character set.
fn base64decode(input: impl AsRef<[u8]>) -> Result<Vec<u8>, base64::DecodeError> {
    base64::decode_config(input, base64::URL_SAFE)
}

fn base64encode(input: impl AsRef<[u8]>) -> String {
    base64::encode_config(input, base64::URL_SAFE)
}

pub(crate) trait HasRoles {
    /// Returns the role of the user.
    fn roles(&self) -> &[String];

    /// Returns an auth token IF this user is a Tobira moderator (as determined
    /// by `config.moderator_role`).
    fn require_moderator(&self, auth_config: &AuthConfig) -> Option<AuthToken> {
        AuthToken::some_if(self.is_moderator(auth_config))
    }

    fn required_upload_permission(&self, auth_config: &AuthConfig) -> Option<AuthToken> {
        AuthToken::some_if(self.can_upload(auth_config))
    }

    fn required_studio_permission(&self, auth_config: &AuthConfig) -> Option<AuthToken> {
        AuthToken::some_if(self.can_use_studio(auth_config))
    }

    fn required_editor_permission(&self, auth_config: &AuthConfig) -> Option<AuthToken> {
        AuthToken::some_if(self.can_use_editor(auth_config))
    }

    fn is_moderator(&self, auth_config: &AuthConfig) -> bool {
        self.is_admin() || self.roles().contains(&auth_config.moderator_role)
    }

    fn can_upload(&self, auth_config: &AuthConfig) -> bool {
        self.is_moderator(auth_config) || self.roles().contains(&auth_config.upload_role)
    }

    fn can_use_studio(&self, auth_config: &AuthConfig) -> bool {
        self.is_moderator(auth_config) || self.roles().contains(&auth_config.studio_role)
    }

    fn can_use_editor(&self, auth_config: &AuthConfig) -> bool {
        self.is_moderator(auth_config) || self.roles().contains(&auth_config.editor_role)
    }

    /// Returns `true` if the user is a global Opencast administrator and can do
    /// anything.
    fn is_admin(&self) -> bool {
        self.roles().iter().any(|role| role == ROLE_ADMIN)
    }
}

impl HasRoles for Option<User> {
    /// Returns the roles of the user if logged in, and `ROLE_ANONYMOUS` otherwise.
    fn roles(&self) -> &[String] {
        static LOGGED_OUT_ROLES: Lazy<[String; 1]> = Lazy::new(|| [ROLE_ANONYMOUS.into()]);

        match self {
            Self::None => &*LOGGED_OUT_ROLES,
            Self::Some(user) => &user.roles,
        }
    }
}

impl HasRoles for User {
    fn roles(&self) -> &[String] {
        &self.roles
    }
}

/// Long running task to perform various DB maintenance.
pub(crate) async fn db_maintenance(db: &Client, config: &AuthConfig) {
    /// Delete outdated user sessions every hour. Note that the session
    /// expiration time is still checked whenever the session is validated. So
    /// this duration is not about correctness, just about how often to clean
    /// up.
    const RUN_PERIOD: Duration = Duration::from_secs(60 * 60);

    loop {
        // Remove outdated user sessions.
        let sql = "delete from user_sessions where extract(epoch from now() - created) > $1";
        match db.execute(sql, &[&config.session_duration.as_secs_f64()]).await {
            Err(e) => error!("Error deleting outdated user sessions: {}", e),
            Ok(0) => debug!("No outdated user sessions found in DB"),
            Ok(num) => info!("Deleted {num} outdated user sessions from DB"),
        }

        tokio::time::sleep(RUN_PERIOD).await;
    }
}
