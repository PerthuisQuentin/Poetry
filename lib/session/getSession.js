const Log = require( '../methods/log' ),
    Models = require( '../../models' ),
    BasicAuth = require( './basicAuth' ),
    Sessions = Models.sessions,
    Users = Models.users,
    Logs = Models.logs,
    Teams = Models.teams;

module.exports = function sessionMiddleware( request, reply ) {

    let cookie = request.state.session;

    if ( request.headers.authorization ) {

        // Basic HTTP auth
        if ( request.headers.authorization.indexOf( 'Basic' ) === 0 )
            return BasicAuth( request )
                .then( sessionRetrieved )
                .catch( err => reply( err )
                    .code( 401 ) );

        // Session token auth
        if ( request.headers.authorization.indexOf( 'Session' ) === 0 )
            cookie = request.headers.authorization.slice( 8 );

    }

    Log.silly( 'Cookie', cookie );

    if ( !cookie ) {
        request.session = {};
        return reply.continue();
    }

    // Get the session from the DB
    var countdown = setTimeout( sessionRetrieved, 1000 );
    Sessions.findOne( {
            _id: cookie
        } )
        .then( session => {
            clearTimeout( countdown );
            sessionRetrieved( session );
        } )
        .catch( error( 'Cannot retrieve SESSION' ) );

    /**
     * sessionRetrieved
     * Connect potential user through given session
     *
     * @param {object} session Session retrieved
     */
    function sessionRetrieved( session ) {

        Log.silly( 'Session', session );

        // No session
        if ( !session ) {
            request.session = {
                _id: cookie
            };
            return reply.continue();
        }

        // Clean old unkeeped sessions
        if ( !session.keep ) session = checkAge( session );

        // Add the found session to request
        request.session = session;

        // If there's no user, delegate
        if ( !session.user || typeof session.user == 'object' )
            return reply.continue();

        if ( session.user.length == 24 ) try {
            session.user = Models.ObjectID( session.user );
        } catch ( err ) {}

        // Populate user
        Users.findOne( {
                _id: session.user
            } )
            .then( populateUser )
            .catch( error( 'Cannot retrieve user' ) );

    }

    function populateUser( user ) {

        // Log the access in the DB
        Logs.insert( {
                user: user._id,
                method: request.method,
                path: request.path,
                params: request.params
            } )
            .then( () => {}, () => {} );

        // Store populated user in request.session
        request.session.user = user;

        // If there's no team, delegate
        if ( !user || !user.team ) return reply.continue();
        if ( user.team == "test" ) {
            request.session.team = {
                _id: "test"
            }
            return reply.continue();
        }

        // Populate team
        Teams.findOne( {
                _id: user.team
            } )
            .then( team => {
                request.session.team = team
                return reply.continue();
            } )
            .catch( error( 'Cannot retrieve TEAM' ) );

    }

    function checkAge( session ) {

        let hourAgo = new Date();
        hourAgo = hourAgo.setHours( hourAgo.getHours - 1 );

        if ( session.updatedAt < hourAgo ) {

            Log.silly( 'Dropped old session', session._id );
            session = {
                _id: session._id
            };

            Sessions.remove( {
                keep: {
                    $not: true
                },
                updatedAt: {
                    $lt: hourAgo
                }
            } );

        }

        return session;

    }

    function error( message ) {

        return err => {
            Log.error( message, err );

            request.session = {};
            return reply.continue();
        }

    }

}
