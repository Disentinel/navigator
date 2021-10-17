import React from 'react';
import './App.css';
import axios from 'axios';
import ForceGraph3d from '3d-force-graph';

const BACKEND_URL = 'http://localhost:9999';

class App extends React.Component {
  constructor(props) {
    super(props);
    this.container = React.createRef();
  }
  componentDidMount = async () => {
    let { data } = await axios.get(BACKEND_URL + '/graph');
    console.log(`Graph`, data);

    let myGraph = ForceGraph3d();
    myGraph(document.getElementById("container"))
      .graphData({
        nodes: data.nodes,
        links: data.edges,
      })
      .nodeId('unique_id')
      .linkSource('from')
      .linkTarget('to')
  }
  render() {
    return <div>
      <div ref={this.container}
        className="graph_container" id="container"></div>
    </div>
  }
}

export default App;
