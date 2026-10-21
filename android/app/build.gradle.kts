plugins {
    id("com.android.application")
}

// En la CI cada compilación sube el número de versión, así una APK nueva se instala encima de la anterior.
val numeroDeCompilacion = providers.environmentVariable("GITHUB_RUN_NUMBER").orNull?.toIntOrNull() ?: 1

// Firma de la versión release: solo si la CI dejó la keystore (secretos del repo). Si no, se usa la APK debug.
val rutaKeystore = providers.environmentVariable("ANDROID_KEYSTORE_PATH").orNull

android {
    namespace = "ar.gravity.app"
    compileSdk = 37
    // La misma NDK con la que se compiló libnode.so (nodejs-mobile 24.x usa r27d): así coincide libc++_shared.so.
    ndkVersion = "27.3.13750724"

    defaultConfig {
        applicationId = "ar.gravity.app"
        minSdk = 26
        // 36 a propósito, NO 37: con targetSdk 37, Android 17 pide el permiso de red local
        // (ACCESS_LOCAL_NETWORK) y cambia reglas de servicios en primer plano; el motor no lo necesita.
        targetSdk = 36
        versionCode = numeroDeCompilacion
        versionName = "2.0.$numeroDeCompilacion"

        // Node.js para Android solo se baja para arm64 (casi todos los celulares desde 2017).
        ndk {
            abiFilters += "arm64-v8a"
        }
        externalNativeBuild {
            cmake {
                arguments += "-DANDROID_STL=c++_shared"
            }
        }
    }

    externalNativeBuild {
        cmake {
            path = file("src/main/cpp/CMakeLists.txt")
        }
    }

    packaging {
        jniLibs {
            // libnode.so pesa 87 MB sin comprimir: comprimida, la APK baja a ~30 MB.
            useLegacyPackaging = true
        }
    }

    signingConfigs {
        // Firma fija para la APK debug (android/firma/): así cada APK nueva se instala encima de la
        // anterior y no se pierden las conversaciones. Es pública: para una firma propia, cargá los
        // secretos ANDROID_KEYSTORE_* en el repo y la CI arma la release.
        getByName("debug") {
            storeFile = file("../firma/gravity-debug.jks")
            storePassword = "gravity"
            keyAlias = "gravity"
            keyPassword = "gravity"
        }
        if (rutaKeystore != null) {
            create("gravity") {
                storeFile = file(rutaKeystore)
                storePassword = providers.environmentVariable("ANDROID_KEYSTORE_PASSWORD").orNull
                keyAlias = providers.environmentVariable("ANDROID_KEY_ALIAS").orNull
                keyPassword = providers.environmentVariable("ANDROID_KEY_PASSWORD").orNull
            }
        }
    }

    buildTypes {
        getByName("release") {
            if (rutaKeystore != null) {
                signingConfig = signingConfigs.getByName("gravity")
            }
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    lint {
        // La CI solo arma la APK; lint se corre a mano con `gradle lint`.
        checkReleaseBuilds = false
    }
}

dependencies {
    // Sin AndroidX ni otras librerías: solo el framework de Android y la biblioteca estándar de Kotlin.
    implementation("org.jetbrains.kotlin:kotlin-stdlib:2.4.21")
}
