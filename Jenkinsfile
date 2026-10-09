/*
 * FlowProbe — declarative Jenkins pipeline.
 * Same stages as the GitHub Actions and Azure DevOps definitions, for teams on self-hosted agents.
 */
pipeline {

    agent {
        docker {
            image 'mcr.microsoft.com/playwright:v1.64.0-jammy'
            args '--ipc=host'
        }
    }

    parameters {
        choice(name: 'TAG', choices: ['@smoke', '@regression', '@api', '@iot', '@a11y'],
               description: 'Tag filter')
        booleanParam(name: 'CROSS_BROWSER', defaultValue: true,
                     description: 'Run the full browser matrix')
    }

    environment {
        CI = 'true'
        FLOWPROBE_TEST_MODE = '1'
    }

    options {
        timeout(time: 45, unit: 'MINUTES')
        buildDiscarder(logRotator(numToKeepStr: '30'))
        timestamps()
    }

    triggers {
        cron(env.BRANCH_NAME == 'main' ? 'H 2 * * *' : '')
    }

    stages {

        stage('Install') {
            steps {
                sh 'npm ci'
            }
        }

        stage('Static analysis') {
            parallel {
                stage('Types') { steps { sh 'npm run typecheck' } }
                stage('Lint') { steps { sh 'npm run lint' } }
                stage('Advisories') { steps { sh 'npm audit --audit-level=high' } }
            }
        }

        stage('API gate') {
            steps {
                sh 'npx playwright test --project=api'
            }
        }

        stage('Browser matrix') {
            when { expression { params.CROSS_BROWSER } }
            parallel {
                stage('Chromium') {
                    steps { sh "npx playwright test --project=chromium --grep ${params.TAG}" }
                }
                stage('Firefox') {
                    steps { sh "npx playwright test --project=firefox --grep ${params.TAG}" }
                }
                stage('WebKit') {
                    steps { sh "npx playwright test --project=webkit --grep ${params.TAG}" }
                }
                stage('Mobile Chrome') {
                    steps { sh "npx playwright test --project=mobile-chrome --grep ${params.TAG}" }
                }
            }
        }

        stage('Postman collection') {
            steps {
                sh '''
                   node app/server.js &
                   npx wait-on http://localhost:4173/api/health --timeout 30000
                   npx newman run postman/FlowProbe_Fleet_API.postman_collection.json \
                       -e postman/local.postman_environment.json \
                       --reporters cli,junit --reporter-junit-export test-results/newman.xml
                '''
            }
        }
    }

    post {
        always {
            // Triage never fails the build; the test run already decided it.
            sh 'node tools/triage.js || true'
            junit allowEmptyResults: true, testResults: 'test-results/*.xml'
            publishHTML(target: [
                reportDir: 'playwright-report',
                reportFiles: 'index.html',
                reportName: 'Playwright report',
                keepAll: true,
                alwaysLinkToLastBuild: true
            ])
            archiveArtifacts artifacts: 'test-results/triage.*', allowEmptyArchive: true
        }
        failure {
            emailext subject: "FAILED: ${env.JOB_NAME} #${env.BUILD_NUMBER}",
                     body: 'Triage summary and traces are attached to the build: ${BUILD_URL}',
                     recipientProviders: [developers(), requestor()]
        }
    }
}
