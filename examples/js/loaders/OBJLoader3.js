/**
 * @author mrdoob / http://mrdoob.com/
 */

'use strict';

THREE.OBJLoader = (function () {

	function OBJLoader( manager ) {
		this.manager = ( manager !== undefined ) ? manager : THREE.DefaultLoadingManager;
		this.path = '';
		this.loadAsArrayBuffer = true;
		this.parser = null;
		this.debug = false;

		this.reInit( this.loadAsArrayBuffer, this.path );
	}

	OBJLoader.prototype.setPath = function ( value ) {
		this.path = value;
	};

	/**
	 * When this is set the ResponseType of the FileLoader is set to arraybuffer and parseArrayBuffer is used.
	 * @param loadAsArrayBuffer
	 */
	OBJLoader.prototype.setLoadAsArrayBuffer = function ( loadAsArrayBuffer ) {
		this.loadAsArrayBuffer = loadAsArrayBuffer;
	};

	OBJLoader.prototype.setContainer = function ( container ) {
		this.parser.extendableMeshCreator.setContainer( container );
	};

	OBJLoader.prototype.setMaterials = function ( materials ) {
		this.parser.extendableMeshCreator.setMaterials( materials );
	};

	OBJLoader.prototype.setCreateObjectPerSmoothingGroup = function ( createObjectPerSmoothingGroup ) {
		this.parser.rawObjectBuilder.setCreateObjectPerSmoothingGroup( createObjectPerSmoothingGroup );
	};

	OBJLoader.prototype.reInit = function ( loadAsArrayBuffer, path, container, materials, createObjectPerSmoothingGroup ) {
		this.parser = new OBJCodeParser();
		this.setLoadAsArrayBuffer( loadAsArrayBuffer );
		this.setPath( path );
		this.setMaterials( materials );
		this.setContainer( container );
		this.setCreateObjectPerSmoothingGroup( createObjectPerSmoothingGroup );
	};

	OBJLoader.prototype.load = function ( url, onLoad, onProgress, onError ) {
		var scope = this;

		var loader = new THREE.FileLoader( scope.manager );
		loader.setPath( this.path );
		loader.setResponseType( this.loadAsArrayBuffer ? 'arraybuffer' : 'text' );
		loader.load( url, function ( loadedContent ) {

			onLoad( scope.parse( loadedContent ) );

		}, onProgress, onError );
	};

	OBJLoader.prototype.parse = function ( loadedContent ) {
		if ( this.loadAsArrayBuffer ) {

			this.parser.parseArrayBuffer( loadedContent );

		} else {

			this.parser.parseText( loadedContent );

		}

		// do not forget last object
		return this.parser.finalize();
	};

	var OBJCodeParser = (function () {

		function OBJCodeParser() {
			this.rawObjectBuilder = new RawObjectBuilder( false );
			this.extendableMeshCreator = new THREE.OBJLoader.ExtendableMeshCreator();

			// globals (per InputObjectStore)
			this.parsers = {
				comments: new LineParserBase( '#', 'pushComment' ),
				mtllib:  new LineParserString( 'mtllib', 'pushMtllib' ),
				vertices: new LineParserVertex( 'v', 'pushVertex' ),
				normals:  new LineParserVertex( 'vn', 'pushNormal' ),
				uvs:  new LineParserUv( 'pushUv' ),
				objects:  new LineParserString( 'o', 'pushObject' ),
				groups: new LineParserString( 'g', 'pushGroup' ),
				usemtls:  new LineParserString( 'usemtl', 'pushMtl' ),
				faces:  new LineParserFace(),
				smoothingGroups:  new LineParserString( 's', 'pushSmoothingGroup' ),
				current: null
			};
			this.reachedFaces = false;
			this.inputObjectCount = 0;

			this.setDebug( false, false, false );
		}

		OBJCodeParser.prototype.setDebug = function ( self, parsers, extendableMeshCreator ) {
			this.debug = self;

			var singleParser;
			for ( var propName in this.parsers ) {
				if ( this.parsers.hasOwnProperty( propName ) ) {
					singleParser = this.parsers[ propName ];
					if ( singleParser !== null) singleParser.debug = parsers;
				}
			}
			this.extendableMeshCreator.debug = extendableMeshCreator;
		};

		OBJCodeParser.prototype.parseArrayBuffer = function ( arrayBuffer ) {
			console.time( 'ParseBytes' );

			var view = new Uint8Array( arrayBuffer );
			for ( var i = 0, length = view.byteLength; i < length; i ++ ) {
				this.parseCode( view [ i ] );
			}

			console.timeEnd( 'ParseBytes' );
		};

		OBJCodeParser.prototype.parseText = function ( input ) {
			console.time( 'ParseString' );

			for ( var i = 0, length = input.length; i < length; i++ ) {
				this.parseCode( input[ i ].charCodeAt( 0 ) );
			}

			console.timeEnd( 'ParseString' );
		};

		/**
		 * TODO: new comment
		 *
		 * @param code
		 */
		OBJCodeParser.prototype.parseCode = function ( code ) {
			switch ( code ) {
				case 10: // LF
					if ( this.parsers.current === null ) return;

					// LF => signal store end of line and reset parser to null (re-evaluate starts for next line)
					this.parsers.current.detectedLF( this.rawObjectBuilder );
					this.parsers.current = null;
					break;

				case 13: // CR
					// ignore CR
					break;

				case 118: // v
					if ( this.parsers.current !== null ) this.parsers.current.parseCode( code );
					break;

				case 110: // n
					this.processIdentifierCharCode( code, this.parsers.normals );
					break;

				case 116: // t
					this.processIdentifierCharCode( code, this.parsers.uvs );
					break;

				case 102: // f
					if ( this.processIdentifierCharCode( code, this.parsers.faces ) ) this.reachedFaces = true;
					break;

				case 115: // s
					this.processIdentifierCharCode( code, this.parsers.smoothingGroups );
					break;

				case 103: // g
					this.processIdentifierCharCode( code, this.parsers.groups );
					break;

				case 117: // u
					this.processIdentifierCharCode( code, this.parsers.usemtls );
					break;

				case 111: // o
					// new instance required, because "o" found and previous vertices exist
					if ( this.processIdentifierCharCode( code, this.parsers.objects ) && this.rawObjectBuilder.vertices.length > 0 ) {
						this.processCompletedObject( false );
					}
					break;

				case 109: // m
					this.processIdentifierCharCode( code, this.parsers.mtllib );
					break;

				case 35: // #
					this.processIdentifierCharCode( code, this.parsers.comments );
					break;

				case 32: // SPACE
					if ( this.parsers.current === null ) {

						// at start of line: not needed, but after 'v' will start new vertex parsing
						this.parsers.current = this.parsers.vertices;

						// object complete instance required if reached faces already (= reached next block of v)
						if ( this.reachedFaces ) this.processCompletedObject( true );

					} else {

						this.parsers.current.parseCode( code );

					}
					break;

				default:
					this.parsers.current.parseCode( code );
					break;
			}
		};

		OBJCodeParser.prototype.processIdentifierCharCode = function ( code, activeParser ) {
			if ( this.parsers.current === null ) {

				this.parsers.current = activeParser;
				return true;

			} else {

				this.parsers.current.parseCode( code );
				return false;
			}
		};

		OBJCodeParser.prototype.processCompletedObject = function ( vertexDetection ) {
			if ( this.debug ) this.rawObjectBuilder.createReport( this.inputObjectCount, true );

			this.extendableMeshCreator.buildMesh( this.rawObjectBuilder.retrievedObjectDescriptions, this.inputObjectCount );
			this.inputObjectCount++;

			this.rawObjectBuilder = this.rawObjectBuilder.newInstance( vertexDetection );
			this.reachedFaces = false;
		};

		OBJCodeParser.prototype.finalize = function () {
			if ( this.debug ) this.rawObjectBuilder.createReport( this.inputObjectCount, true );

			this.extendableMeshCreator.buildMesh( this.rawObjectBuilder.retrievedObjectDescriptions, this.inputObjectCount );
			this.inputObjectCount++;

			this.rawObjectBuilder = null;
			this.reachedFaces = false;

			console.log( 'Global output object count: ' + this.extendableMeshCreator.globalObjectCount );

			return this.extendableMeshCreator.container;
		};

		var LineParserBase = (function () {

			function LineParserBase( description, oobRefFunction  ) {
				this.oobRefFunction = oobRefFunction;

				// variables re-init (newLine) per input line (called by InputObjectStore)
				this.input = '';
				this.description = description ? description : 'noname: ';

				this.debug = false;
			}

			/**
			 * Per default all input is taken.
			 * Extensions behave differently by overriding this method.
			 */
			LineParserBase.prototype.parseCode = function ( code ) {
				this.input += String.fromCharCode( code );
			};

			/**
			 * Per default only the input is passed to the ObjectOutputBuilder.
			 * Extensions behave differently by overriding this method.
			 */
			LineParserBase.prototype.detectedLF = function ( oobRef ) {
				if ( this.oobRefFunction) oobRef[ this.oobRefFunction ]( this.input );

				if ( this.debug ) console.log( this.description + ': ' + this.input );

				this.input = '';
			};

			return LineParserBase;
		})();


		var LineParserString = (function () {

			LineParserString.prototype = Object.create( LineParserBase.prototype );
			LineParserString.prototype.constructor = LineParserString;

			function LineParserString( description, oobRefFunction ) {
				LineParserBase.call( this, description, oobRefFunction );
				this.foundFirstSpace = false;
			}

			LineParserString.prototype.parseCode = function ( code ) {
				if ( this.foundFirstSpace ) {

					this.input += String.fromCharCode( code );

				} else if ( code === 32 ) {

					this.foundFirstSpace = true;
				}
			};

			LineParserString.prototype.detectedLF = function ( oobRef ) {
				oobRef[this.oobRefFunction]( this.input );

				if ( this.debug ) console.log( this.description + ': ' + this.input );

				this.input = '';
				this.foundFirstSpace = false;
			};

			return LineParserString;
		})();


		var LineParserVertex = (function () {

			LineParserVertex.prototype = Object.create( LineParserBase.prototype );
			LineParserVertex.prototype.constructor = LineParserVertex;

			function LineParserVertex( type, oobRefFunction ) {
				LineParserBase.call( this, type, oobRefFunction );
				this.minInputLength = 0;
				this.buffer = new Array( 3 );
				this.bufferIndex = 0;
			}

			LineParserVertex.prototype.parseCode = function ( code ) {
				// "v   1.0 2.0 3.0" or
				// "vn  1.0 2.0 3.0" or

				if ( code === 32) {

					this.pushToBuffer();

				} else {

					this.input += String.fromCharCode( code );

				}
			};

			LineParserVertex.prototype.pushToBuffer = function () {
				if ( this.input.length > this.minInputLength ) {

					this.buffer[ this.bufferIndex ] = parseFloat( this.input );
					this.bufferIndex++;
					this.input = '';

				}
			};

			LineParserVertex.prototype.detectedLF = function ( oobRef ) {
				this.pushToBuffer();

				if ( this.oobRefFunction ) oobRef[ this.oobRefFunction ]( this.buffer );
				if ( this.debug ) console.log( this.description + ': ' + this.buffer );

				this.bufferIndex = 0;
			};

			return LineParserVertex;
		})();


		var LineParserUv = (function () {

			LineParserUv.prototype = Object.create( LineParserVertex.prototype );
			LineParserUv.prototype.constructor = LineParserUv;

			function LineParserUv( oobRefFunction ) {
				LineParserVertex.call( this, 'vt', oobRefFunction );

				this.buffer = new Array( 2 );
				// variables re-init per input line
				this.retrievedFloatCount = 0;
			}

			LineParserUv.prototype.parseCode = function ( code ) {
				// "vt  1.0 2.0 0.0" -> do not use "w"

				// w is optional for 2D textures; only required for 3D textures (not implemented)
				if ( this.retrievedFloatCount == 2 ) return;

				LineParserVertex.prototype.parseCode.call( this, code );
			};

			LineParserUv.prototype.pushToBuffer = function () {
				if ( this.input.length > this.minInputLength ) {

					this.buffer[ this.bufferIndex ] = parseFloat( this.input );
					this.bufferIndex++;
					this.retrievedFloatCount++;
					this.input = '';

				}
			};

			LineParserUv.prototype.detectedLF = function ( oobRef ) {
				LineParserVertex.prototype.detectedLF.call( this, oobRef );
				this.retrievedFloatCount = 0;
			};

			return LineParserUv;
		})();


		/**
		 * Support for triangle or quads:
		 * 0: "f vertex/uv/normal	vertex/uv/normal	vertex/uv/normal	vertex/uv/normal"
		 * 1: "f vertex/uv			vertex/uv			vertex/uv			vertex/uv"
		 * 2: "f vertex//normal		vertex//normal		vertex//normal		vertex//normal"
		 * 3: "f vertex				vertex				vertex				vertex"
		 */
		var LineParserFace = (function () {

			LineParserFace.prototype = Object.create( LineParserVertex.prototype );
			LineParserFace.prototype.constructor = LineParserFace;

			function LineParserFace() {


				LineParserVertex.call( this, 'f', 12 );

				// variables re-init by detectedLF
				this.slashCount = 0;
				this.type = 3;
			}

			LineParserFace.prototype.parseCode = function ( code ) {
				if ( code === 32 ) {

					if ( this.slashCount === 1 ) this.type = 1;
					this.pushToBuffer();

				} else if ( code === 47 ) {

					if ( this.slashCount < 2 && this.type !== 1 ) {

						this.slashCount ++;
						this.type = ( this.input.length === 0 ) ? 2 : 0;

					}
					this.pushToBuffer();

				} else {

					this.input += String.fromCharCode( code );

				}
			};

			LineParserFace.prototype.pushToBuffer = function () {
				if ( this.input.length > this.minInputLength ) {

					this.buffer[ this.bufferIndex ] = parseInt( this.input, 10 );
					this.bufferIndex++;
					this.input = '';

				}
			};

			LineParserFace.prototype.detectedLF = function ( oobRef ) {
				this.pushToBuffer();

				var combinedType = this.bufferIndex % 4 === 0 ?  10 + this.type : this.type;
				oobRef.pushFace( combinedType, this.buffer );

				if ( this.debug ) console.log( 'Faces type: ' + this.type + ': ' + this.buffer );

				this.bufferIndex = 0;
				this.slashCount = 0;
				this.type = 3;
			};

			return LineParserFace;
		})();

		return OBJCodeParser;
	})();


	var FACE_TYPE_0_FACE = 0;
	var FACE_TYPE_1_FACE = 1;
	var FACE_TYPE_2_FACE = 2;
	var FACE_TYPE_3_FACE = 3;
	var FACE_TYPE_0_QUAD = 10;
	var FACE_TYPE_1_QUAD = 11;
	var FACE_TYPE_2_QUAD = 12;
	var FACE_TYPE_3_QUAD = 13;

	var RawObjectBuilder = (function () {

		var VERTEX_AND_NORMAL_VECTOR_LENGTH = 3;
		var UV_VECTOR_LENGTH = 2;

		function RawOjectBuilder( activeGroupOverride ) {
			this.createObjectPerSmoothingGroup = false;
			this.globalVertexOffset = 1;
			this.globalUvOffset = 1;
			this.globalNormalOffset = 1;

			this.objectName = 'none';

			this.vertices = [];
			this.verticesIndex = 0;
			this.normals = [];
			this.normalsIndex = 0;
			this.uvs = [];
			this.uvsIndex = 0;
			this.comments = [];

			this.mtllibName = '';

			// faces are store according combined index of groups, material and smoothing group
			this.activeGroup = ( activeGroupOverride === undefined ) ? 'none' : activeGroupOverride;
			this.activeMtlName = 'none';
			this.activeSmoothingGroup = 0;

			this.objectGroupCount = 0;
			this.mtlCount = 0;
			this.smoothingGroupCount = 0;

			this.retrievedObjectDescriptions = [];
			var index = this.buildIndexRegular();
			this.retrievedObjectDescriptionInUse = this.retrievedObjectDescriptions[ index ] = new THREE.OBJLoader.RetrievedObjectDescription(
				this.objectName, this.activeGroup, this.activeMtlName, this.activeSmoothingGroup );
		}

		RawOjectBuilder.prototype.setCreateObjectPerSmoothingGroup = function ( createObjectPerSmoothingGroup ) {
			this.createObjectPerSmoothingGroup = createObjectPerSmoothingGroup;
		};

		RawOjectBuilder.prototype.newInstance = function ( vertexDetection ) {
			var newOob;
			if ( vertexDetection ) {

				newOob = new RawOjectBuilder( this.createObjectPerSmoothingGroup, this.activeGroup );

			} else {

				newOob = new RawOjectBuilder( this.createObjectPerSmoothingGroup );

			}
			newOob.globalVertexOffset = this.globalVertexOffset + this.verticesIndex / 3;
			newOob.globalUvOffset = this.globalUvOffset + this.uvsIndex / 2;
			newOob.globalNormalOffset = this.globalNormalOffset + this.normalsIndex / 3;

			return newOob;
		};

		RawOjectBuilder.prototype.pushToBuffer = function ( source, target, targetIndex ) {
			for ( var i = 0, length = source.length; i < length; i++ ) {

				target[ targetIndex ] = source[ i ];
				targetIndex++;

			}
			return targetIndex;
		};

		RawOjectBuilder.prototype.pushVertex = function ( vertexArray ) {
			this.verticesIndex = this.pushToBuffer( vertexArray, this.vertices, this.verticesIndex );
		};

		RawOjectBuilder.prototype.pushNormal = function ( normalArray ) {
			this.normalsIndex = this.pushToBuffer( normalArray, this.normals, this.normalsIndex );
		};

		RawOjectBuilder.prototype.pushUv = function ( uvArray ) {
			this.uvsIndex = this.pushToBuffer( uvArray, this.uvs, this.uvsIndex );
		};

		RawOjectBuilder.prototype.pushComment = function ( comment ) {
			this.comments.push( comment );
		};

		RawOjectBuilder.prototype.pushObject = function ( objectName ) {
			this.objectName = objectName;
		};

		RawOjectBuilder.prototype.pushMtllib = function ( mtllibName ) {
			this.mtllibName = mtllibName;
		};

		RawOjectBuilder.prototype.pushGroup = function ( groupName ) {
			if ( this.activeGroup === groupName ) return;
			this.activeGroup = groupName;
			this.objectGroupCount++;

			this.verifyIndex();
		};

		RawOjectBuilder.prototype.pushMtl = function ( mtlName ) {
			if ( this.activeMtlName === mtlName ) return;
			this.activeMtlName = mtlName;
			this.mtlCount++;

			this.verifyIndex();
		};

		RawOjectBuilder.prototype.pushSmoothingGroup = function ( activeSmoothingGroup ) {
			var normalized = activeSmoothingGroup === 'off' ? 0 : activeSmoothingGroup;
			if ( this.activeSmoothingGroup === normalized ) return;
			this.activeSmoothingGroup = normalized;
			this.smoothingGroupCount++;

			this.verifyIndex();
		};

		RawOjectBuilder.prototype.verifyIndex = function () {
			var index;

			if ( this.createObjectPerSmoothingGroup ) {

				index = this.buildIndexRegular();

			} else {

				index = ( this.activeSmoothingGroup === 0 ) ? this.buildIndexOverride( 0 ) : this.buildIndexOverride( 1 );

			}

			if ( this.retrievedObjectDescriptions[ index ] === undefined ) {

				this.retrievedObjectDescriptionInUse = this.retrievedObjectDescriptions[ index ] = new THREE.OBJLoader.RetrievedObjectDescription(
					this.objectName, this.activeGroup, this.activeMtlName, this.activeSmoothingGroup );

			}
			else {

				this.retrievedObjectDescriptionInUse = this.retrievedObjectDescriptions[ index ];

			}
		};

		RawOjectBuilder.prototype.buildIndexRegular = function () {
			return this.objectName + '|' + this.activeGroup + '|' + this.activeMtlName + '|' + this.activeSmoothingGroup;
		};

		RawOjectBuilder.prototype.buildIndexOverride = function ( smoothingGroup ) {
			return this.objectName + '|' + this.activeGroup + '|' + this.activeMtlName + '|' + smoothingGroup;
		};


		RawOjectBuilder.prototype.pushFace = function ( combinedType, facesArray ) {
			switch ( combinedType ) {
				case FACE_TYPE_0_QUAD:
					// 0, 1, 2, 0, 2, 3
					this.attachFaceVertex( facesArray[0] );
					this.attachFaceUv( facesArray[1] );
					this.attachFaceNormal( facesArray[2] );
					this.attachFaceVertex( facesArray[3] );
					this.attachFaceUv( facesArray[4] );
					this.attachFaceNormal( facesArray[5] );
					this.attachFaceVertex( facesArray[6] );
					this.attachFaceVertex( facesArray[0] );
					this.attachFaceVertex( facesArray[6] );
					this.attachFaceUv( facesArray[7] );
					this.attachFaceNormal( facesArray[8] );
					this.attachFaceVertex( facesArray[9] );

					this.attachFaceUv( facesArray[1] );
					this.attachFaceNormal( facesArray[2] );
					this.attachFaceUv( facesArray[7] );
					this.attachFaceNormal( facesArray[8] );
					this.attachFaceUv( facesArray[10] );
					this.attachFaceNormal( facesArray[11] );
					break;

				case FACE_TYPE_0_FACE:
					this.attachFaceVertex( facesArray[0] );
					this.attachFaceUv( facesArray[1] );
					this.attachFaceNormal( facesArray[2] );
					this.attachFaceVertex( facesArray[3] );
					this.attachFaceUv( facesArray[4] );
					this.attachFaceNormal( facesArray[5] );
					this.attachFaceVertex( facesArray[6] );
					this.attachFaceUv( facesArray[7] );
					this.attachFaceNormal( facesArray[8] );
					break;

				case FACE_TYPE_1_QUAD:
					// 0, 1, 2, 0, 2, 3
					this.attachFaceVertex( facesArray[0] );
					this.attachFaceUv( facesArray[1] );
					this.attachFaceVertex( facesArray[2] );
					this.attachFaceUv( facesArray[3] );
					this.attachFaceVertex( facesArray[4] );
					this.attachFaceUv( facesArray[5] );

					this.attachFaceVertex( facesArray[0] );
					this.attachFaceUv( facesArray[1] );
					this.attachFaceVertex( facesArray[4] );
					this.attachFaceUv( facesArray[5] );
					this.attachFaceVertex( facesArray[6] );
					this.attachFaceUv( facesArray[7] );
					break;

				case FACE_TYPE_1_FACE:
					this.attachFaceVertex( facesArray[0] );
					this.attachFaceUv( facesArray[1] );
					this.attachFaceVertex( facesArray[2] );
					this.attachFaceUv( facesArray[3] );
					this.attachFaceVertex( facesArray[4] );
					this.attachFaceUv( facesArray[5] );
					break;

				case FACE_TYPE_2_QUAD:
					// 0, 1, 2, 0, 2, 3
					this.attachFaceVertex( facesArray[0] );
					this.attachFaceNormal( facesArray[1] );
					this.attachFaceVertex( facesArray[2] );
					this.attachFaceNormal( facesArray[3] );
					this.attachFaceVertex( facesArray[4] );
					this.attachFaceNormal( facesArray[5] );

					this.attachFaceVertex( facesArray[0] );
					this.attachFaceNormal( facesArray[1] );
					this.attachFaceVertex( facesArray[4] );
					this.attachFaceNormal( facesArray[5] );
					this.attachFaceVertex( facesArray[6] );
					this.attachFaceNormal( facesArray[7] );
					break;

				case FACE_TYPE_2_FACE:
					this.attachFaceVertex( facesArray[0] );
					this.attachFaceNormal( facesArray[1] );
					this.attachFaceVertex( facesArray[2] );
					this.attachFaceNormal( facesArray[3] );
					this.attachFaceVertex( facesArray[4] );
					this.attachFaceNormal( facesArray[5] );
					break;

				case FACE_TYPE_3_QUAD:
					// 0, 1, 2, 0, 2, 3
					this.attachFaceVertex( facesArray[0] );
					this.attachFaceVertex( facesArray[1] );
					this.attachFaceVertex( facesArray[2] );

					this.attachFaceVertex( facesArray[0] );
					this.attachFaceVertex( facesArray[2] );
					this.attachFaceVertex( facesArray[3] );
					break;

				case FACE_TYPE_3_FACE:
					this.attachFaceVertex( facesArray[0] );
					this.attachFaceVertex( facesArray[1] );
					this.attachFaceVertex( facesArray[2] );
					break;
				default:
					break;
			}
		};

		RawOjectBuilder.prototype.attachFaceVertex = function ( faceIndex ) {
			var index = ( faceIndex - this.globalVertexOffset ) * VERTEX_AND_NORMAL_VECTOR_LENGTH;

			this.retrievedObjectDescriptionInUse.vertexArray[ this.retrievedObjectDescriptionInUse.vertexArrayIndex++ ] = this.vertices[ index++ ];
			this.retrievedObjectDescriptionInUse.vertexArray[ this.retrievedObjectDescriptionInUse.vertexArrayIndex++ ] = this.vertices[ index++ ];
			this.retrievedObjectDescriptionInUse.vertexArray[ this.retrievedObjectDescriptionInUse.vertexArrayIndex++ ] = this.vertices[ index ];
		};

		RawOjectBuilder.prototype.attachFaceUv = function ( faceIndex ) {
			var index = ( faceIndex - this.globalUvOffset ) * UV_VECTOR_LENGTH;

			this.retrievedObjectDescriptionInUse.uvArray[ this.retrievedObjectDescriptionInUse.uvArrayIndex++ ] = this.uvs[ index++ ];
			this.retrievedObjectDescriptionInUse.uvArray[ this.retrievedObjectDescriptionInUse.uvArrayIndex++ ] = this.uvs[ index ];
		};

		RawOjectBuilder.prototype.attachFaceNormal = function ( faceIndex ) {
			var index = ( faceIndex - this.globalNormalOffset ) * VERTEX_AND_NORMAL_VECTOR_LENGTH;

			this.retrievedObjectDescriptionInUse.normalArray[ this.retrievedObjectDescriptionInUse.normalArrayIndex++ ] = this.normals[ index++ ];
			this.retrievedObjectDescriptionInUse.normalArray[ this.retrievedObjectDescriptionInUse.normalArrayIndex++ ] = this.normals[ index++ ];
			this.retrievedObjectDescriptionInUse.normalArray[ this.retrievedObjectDescriptionInUse.normalArrayIndex++ ] = this.normals[ index ];
		};

		RawOjectBuilder.prototype.createReport = function ( inputObjectCount, printDirectly ) {
			var report = {
				name: this.objectName ? this.objectName : 'groups',
				mtllibName: this.mtllibName,
				vertexCount: this.vertices.length / 3,
				normalCount: this.normals.length / 3,
				uvCount: this.uvs.length / 2,
				objectGroupCount: this.objectGroupCount,
				smoothingGroupCount: this.smoothingGroupCount,
				mtlCount: this.mtlCount,
				commentCount: this.comments ? this.comments.length : 0
			};

			if ( printDirectly ) {
				console.log( 'Input Object number: ' + inputObjectCount + ' Object name: ' + report.name );
				console.log( 'Mtllib name: ' + report.mtllibName );
				console.log( 'Vertex count: ' + report.vertexCount );
				console.log( 'Normal count: ' + report.normalCount );
				console.log( 'UV count: ' + report.uvCount );
				console.log( 'Group count: ' + report.objectGroupCount );
				console.log( 'SmoothingGroup count: ' + report.smoothingGroupCount );
				console.log( 'Material count: ' + report.mtlCount );
				console.log( 'Comments count: ' + report.commentCount );
				console.log( '' );
			}

			return report;
		};

		return RawOjectBuilder;
	})();

	return OBJLoader;
})();


THREE.OBJLoader.RetrievedObjectDescription = (function () {

	function RetrievedObjectDescription( objectName, group, materialName, smoothingGroup ) {
		this.objectName = objectName;
		this.group = group;
		this.materialName = materialName;
		this.smoothingGroup = smoothingGroup;

		this.vertexArray = [];
		this.vertexArrayIndex = 0;
		this.uvArray = [];
		this.uvArrayIndex = 0;
		this.normalArray = [];
		this.normalArrayIndex = 0;
	}

	return RetrievedObjectDescription;
})();

THREE.OBJLoader.ExtendableMeshCreator = (function () {

	function ExtendableMeshCreator() {
		this.container = new THREE.Group();
		this.materials = null;
		this.debug = false;

		this.globalObjectCount = 0;
	}

	ExtendableMeshCreator.prototype.setContainer = function ( container ) {
		this.container = ( container !== undefined && container !== null ) ? container : this.container;
	};

	ExtendableMeshCreator.prototype.setMaterials = function ( materials ) {
		this.materials = materials;
	};

	ExtendableMeshCreator.prototype.buildMesh = function ( retrievedObjectDescriptions, inputObjectCount ) {
		var retrievedObjectDescription;

		if ( this.debug ) console.log( 'ExtendableMeshCreator.buildRawMeshData: Processing object no.: ' + inputObjectCount );

		for ( var index in retrievedObjectDescriptions ) {
			retrievedObjectDescription = retrievedObjectDescriptions[ index ];

			if ( retrievedObjectDescription.vertexArrayIndex > 0 ) {

				if ( this.debug ) {
					console.log(
						'Object no.: ' + this.globalObjectCount +
						' objectName: ' + retrievedObjectDescription.objectName +
						' group: ' + retrievedObjectDescription.group +
						' materialName: ' + retrievedObjectDescription.materialName +
						' smoothingGroup: ' + retrievedObjectDescription.smoothingGroup +
						'\nCounts: ' +
						' #vertices: ' + retrievedObjectDescription.vertexArrayIndex / 3 +
						' #uvs: ' + + retrievedObjectDescription.uvArrayIndex / 2 +
						' #normals: ' + + retrievedObjectDescription.normalArrayIndex / 3
					);
				}

				var bufferGeometry = new THREE.BufferGeometry();
				bufferGeometry.addAttribute( 'position', new THREE.BufferAttribute( new Float32Array( retrievedObjectDescription.vertexArray ), 3 ) );
				if ( retrievedObjectDescription.normalArrayIndex > 0 ) {

					bufferGeometry.addAttribute( 'normal', new THREE.BufferAttribute( new Float32Array( retrievedObjectDescription.normalArray ), 3 ) );

				}
				else {

					bufferGeometry.computeVertexNormals();

				}
				if ( retrievedObjectDescription.uvArrayIndex > 0 ) {

					bufferGeometry.addAttribute( 'uv', new THREE.BufferAttribute( new Float32Array( retrievedObjectDescription.uvArray ), 2 ) );

				}

				var material = this.materials.materials[ retrievedObjectDescription.materialName ];
				if ( material === undefined ) material = new THREE.MeshStandardMaterial();

				// clone material in case flat shading is needed due to smoothingGroup 0
				if ( retrievedObjectDescription.smoothingGroup === 0 ) {
					material = material.clone();
					material.shading = THREE.FlatShading;
				}

				var mesh = new THREE.Mesh( bufferGeometry, material );
				this.container.add( mesh );

				this.globalObjectCount++;
			}
		}
	};

	return ExtendableMeshCreator;
})();