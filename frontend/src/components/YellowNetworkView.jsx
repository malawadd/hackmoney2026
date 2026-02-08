/**
 * Yellow Network View Component Wrapper
 * Import this into App.jsx to add the Yellow Network view
 */

import YellowNetworkDemo from './YellowNetworkDemo';

export function YellowNetworkView({ Header, Footer }) {
    return (
        <div className="app">
            <Header />
            <main className="main">
                <YellowNetworkDemo />
            </main>
            <Footer />
        </div>
    );
}

export default YellowNetworkView;

/**
 * Add this to App.jsx:
 * 
 * import YellowNetworkView from './components/YellowNetworkView';
 *  
 * if (currentView === 'yellow') {
 *   return <YellowNetworkView Header={Header} Footer={Footer} />;
 * }
 */
