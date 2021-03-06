const Mongo = require( 'promised-mongo' ),
    Log = require( './lib/methods/log' ),
    Events = require( './lib/methods/events' ),
    local = 'localhost/database';

// Are the env. variables set ?
let url = process.env.DATABASE || process.env.database;

// Try the default rancher config
if ( !url ) {
    if (
        process.env.MONGODB_MONGO_CLUSTER_1_PORT &&
        process.env.MONGODB_MONGO_CLUSTER_2_PORT && process.env.MONGODB_MONGO_CLUSTER_3_PORT
    ) url = 'mongodb://mongodb_mongo-cluster_1/database';
    else {
        url = process.env.DATABASE_PORT || process.env.database_port;
        if ( url ) {
            url += '/database';
            if ( ~url.indexOf( '://' ) )
                url = url.split( '://', 2 )[ 1 ];
        }
    }
}


// Otherwise, localhost default config
if ( !url ) url = local;

Log.info( 'Using MongoDB', url );

module.exports = new Proxy( Mongo( url ), {
    get( db, model ) {
        if ( typeof model !== 'string' ) return undefined;
        if ( ~[ 'inspect', 'valueOf' ].indexOf( model ) )
            return undefined;

        if ( model == 'ObjectId' || model == 'ObjectID' )
            return db.ObjectId;

        model = model.toLowerCase();
        if ( model.charAt( model.length - 1 ) != 's' )
            model += 's';

        return new Proxy( db[ model ], {
            get( modelORM, method ) {

                if ( ~[ 'find', 'count', 'findone' ].indexOf( method ) )
                    return modelORM[ method ];

                if ( typeof modelORM[ method ] !== 'function' && method != 'set' )
                    return modelORM[ method ];

                if ( method == 'create' ) method = 'insert';
                if ( method == 'delete' ) method = 'remove';

                return function () {
                    let args = arguments;
                    let returnValue = false;

                    if ( method == 'set' ) {
                        returnValue = true;
                        if ( !args[ 2 ] ) args[ 2 ] = {};
                        if ( args[ 2 ].new === undefined ) args[ 2 ].new = true;
                        args[ 2 ].query = args[ 0 ];
                        args[ 2 ].update = {
                            $set: args[ 1 ]
                        };
                        method = 'findAndModify';
                        args = [ args[ 2 ] ];
                    }

                    if ( method == 'insert' || method == 'save' )
                        if ( Array.isArray( args[ 0 ] ) ) {
                            let d = new Date;
                            args[ 0 ].map( entry => {
                                if ( !entry.createdAt )
                                    entry.createdAt = d;
                            } );
                        } else if ( !args[ 0 ].createdAt )
                            args[ 0 ].createdAt = new Date;

                    if ( method == 'update' || method == 'save' ) {
                        args[ 0 ].updatedAt = new Date;
                    }

                    if ( method == 'update' ) returnValue = true;

                    if ( method == 'findAndModify' && args[ 0 ] && args[ 0 ].update && args[ 0 ].update.$set ) {
                        args[ 0 ].update.$set.updatedAt = new Date;
                        returnValue = true;
                    }

                    return new Promise( ( resolve, reject ) => {

                        let promise = modelORM[ method ].apply( modelORM, args );

                        promise.then( ( result ) => {

                                if ( returnValue )
                                    result = result.value;

                                resolve( result );
                                // args.result = result;

                                if ( method == 'findAndModify' ) method = 'update';
                                Events.emit( method + ':' + model, result );

                                // if ( method == 'update' || method == 'insert' ) {
                                //     args.method = method;
                                //     Events.emit( 'save:' + model, args );
                                // }
                            } )
                            .catch( ( err ) => {
                                reject( err );
                                Log.warn( model + '.' + method, err );
                            } );
                    } );
                };
            }
        } );
    }
} );
